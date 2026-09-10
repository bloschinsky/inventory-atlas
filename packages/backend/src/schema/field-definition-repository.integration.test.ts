import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { TransactionalOutboxPort, type OutboxPort } from '../infrastructure/index.js';
import { FieldDefinitionRepository } from './field-definition-repository.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `schema_fields_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-09-09T10:00:00.000Z');
let adminPool: Pool;
let pool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let repository: FieldDefinitionRepository;
let categoryId: string;
let lifecycleStatusId: string;

async function createFixtureItem(id = randomUUID()): Promise<string> {
  await prisma.item.create({
    data: {
      id,
      publicId: randomUUID(),
      slug: `fixture-${id.replaceAll('-', '')}`,
      categoryId,
      lifecycleStatusId,
      displayName: 'Schema fixture item',
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function audits(entityId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    'select action, before_json, after_json from audit_events where entity_id = $1 order by created_at, action',
    [entityId],
  );
  return rows;
}

async function outbox(aggregateId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    'select topic, payload_json, deduplication_key from outbox where aggregate_id = $1 order by created_at',
    [aggregateId],
  );
  return rows;
}

function definitionInput(overrides: Record<string, unknown> = {}) {
  return {
    key: `field_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    scope: 'item',
    labels: { en: 'Serial number', uk: 'Серійний номер' },
    dataType: 'text',
    ...overrides,
  };
}

suite('CAT-02 field definitions on PostgreSQL', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    const schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    pool = new Pool({ connectionString: schemaUrl, max: 2 });
    prisma = createSettingsClient(schemaUrl, 4);
    repository = new FieldDefinitionRepository(prisma, () => now);
    categoryId = (
      await prisma.category.create({
        data: {
          id: randomUUID(),
          key: 'electronics',
          labelI18n: { en: 'Electronics', uk: 'Електроніка' },
          createdAt: now,
          updatedAt: now,
        },
      })
    ).id;
    lifecycleStatusId = (
      await prisma.lifecycleStatus.create({
        data: {
          id: randomUUID(),
          key: 'stored',
          labelI18n: { en: 'Stored' },
          colorToken: 'status.info',
          createdAt: now,
          updatedAt: now,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await pool?.end();
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('creates definitions with every flag, unit, default and validation rule set', async () => {
    const created = await repository.createDefinition({
      key: 'quantity',
      scope: 'item',
      categoryId,
      labels: { en: 'Quantity', uk: 'Кількість' },
      help: { en: 'Whole units', uk: 'Цілі одиниці' },
      dataType: 'number',
      required: true,
      repeatable: true,
      searchable: true,
      filterable: true,
      sortable: true,
      visibility: 'public',
      unit: 'pcs',
      defaultValue: '1',
      validation: { min: 0, max: 100000, integer: true },
      displayOrder: 30,
    });
    expect(created).toMatchObject({
      key: 'quantity',
      scope: 'item',
      categoryId,
      dataType: 'number',
      required: true,
      repeatable: true,
      searchable: true,
      filterable: true,
      sortable: true,
      visibility: 'public',
      unit: 'pcs',
      validation: { min: '0', max: '100000', integer: true },
      displayOrder: 30,
      version: 1,
      archivedAt: null,
      options: [],
    });
    expect(created.defaultValue).toEqual(['1']);
    expect(created.help).toEqual({ en: 'Whole units', uk: 'Цілі одиниці' });
    const [event] = await audits(created.id);
    expect(event).toMatchObject({ action: 'schema.field-definition.created', before_json: null });
    // A stored default value never enters the audit payload.
    expect(event!.after_json).toMatchObject({ key: 'quantity', hasDefaultValue: true });
    expect(JSON.stringify(event!.after_json)).not.toContain('defaultValue"');
  });

  it('rejects unapproved metadata, repeatable option types and inactive categories', async () => {
    for (const invalid of [
      { key: 'Quantity' },
      { scope: 'node' },
      { dataType: 'integer' },
      { visibility: 'unlisted' },
      { labels: { uk: 'Кількість' } },
      { unit: ' ' },
      { displayOrder: -1 },
      { dataType: 'select', repeatable: true },
      { dataType: 'multiselect', repeatable: true },
      { dataType: 'number', validation: { pattern: '^1$' } },
      { dataType: 'number', defaultValue: 'abc' },
      { dataType: 'select', defaultValue: 'new' },
    ]) {
      await expect(
        repository.createDefinition(definitionInput(invalid)),
        JSON.stringify(invalid),
      ).rejects.toMatchObject({ name: 'SchemaPolicyError' });
    }
    const archivedCategory = await prisma.category.create({
      data: {
        id: randomUUID(),
        key: 'documents',
        labelI18n: { en: 'Documents' },
        createdAt: now,
        updatedAt: now,
        archivedAt: now,
      },
    });
    await expect(
      repository.createDefinition(definitionInput({ categoryId: archivedCategory.id })),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_CATEGORY_INVALID' });
  });

  it('resolves the schema for a scope and category and keeps archived definitions readable', async () => {
    const global = await repository.createDefinition(
      definitionInput({ key: 'global_note', displayOrder: 5 }),
    );
    const scoped = await repository.createDefinition(
      definitionInput({ key: 'scoped_note', categoryId, displayOrder: 1 }),
    );
    const nodeField = await repository.createDefinition(
      definitionInput({ key: 'shelf_capacity', scope: 'storage_node', dataType: 'number' }),
    );
    const resolved = await repository.listDefinitions({ scope: 'item', categoryId });
    expect(resolved.map((definition) => definition.key)).toContain('scoped_note');
    expect(resolved.map((definition) => definition.key)).toContain('global_note');
    expect(resolved.map((definition) => definition.key)).not.toContain('shelf_capacity');
    expect(resolved.findIndex((definition) => definition.id === scoped.id)).toBeLessThan(
      resolved.findIndex((definition) => definition.id === global.id),
    );
    const nodeSchema = await repository.listDefinitions({ scope: 'storage_node' });
    expect(nodeSchema.map((definition) => definition.id)).toEqual([nodeField.id]);
    const scopeOnly = await repository.listDefinitions({ scope: 'item', categoryId: null });
    expect(scopeOnly.map((definition) => definition.key)).not.toContain('scoped_note');

    const archived = await repository.archiveDefinition(scoped.id, scoped.version);
    expect(archived.definition.archivedAt).toEqual(now);
    expect(
      (await repository.listDefinitions({ scope: 'item', categoryId })).map(({ id }) => id),
    ).not.toContain(scoped.id);
    expect((await repository.findDefinitionById(scoped.id))?.key).toBe('scoped_note');
    expect(await repository.findDefinitionById(scoped.id, false)).toBeNull();
  });

  it('increments the version once per change and rejects a stale expected version', async () => {
    const created = await repository.createDefinition(definitionInput());
    const first = await repository.updateDefinition(created.id, created.version, {
      displayOrder: 7,
    });
    expect(first.definition.version).toBe(2);
    await expect(
      repository.updateDefinition(created.id, created.version, { displayOrder: 8 }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_VERSION_CONFLICT' });
    await expect(
      repository.updateDefinition(randomUUID(), 1, { displayOrder: 1 }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_NOT_FOUND' });
    await expect(repository.updateDefinition(created.id, 0, {})).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_INVALID_VERSION',
    });
    const [, update] = await audits(created.id);
    expect(update).toMatchObject({ action: 'schema.field-definition.updated' });
    expect(update!.before_json).toMatchObject({ displayOrder: 0, version: 1 });
    expect(update!.after_json).toMatchObject({ displayOrder: 7, version: 2 });
  });

  it('keeps the stable key and scope immutable through the repository and the database', async () => {
    const created = await repository.createDefinition(definitionInput({ key: 'immutable_key' }));
    await repository.updateDefinition(created.id, created.version, {
      labels: { en: 'Renamed', uk: 'Перейменовано' },
    });
    expect((await repository.findDefinitionById(created.id))?.key).toBe('immutable_key');
    await expect(
      pool.query('update field_definitions set key = $2 where id = $1', [created.id, 'other_key']),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('warns and enqueues one rebuild only when public or search behavior changes', async () => {
    const created = await repository.createDefinition(definitionInput({ key: 'reindexed' }));
    const quiet = await repository.updateDefinition(created.id, created.version, {
      displayOrder: 4,
      unit: 'kg',
      help: { en: 'Help' },
      required: true,
    });
    expect(quiet.reindex).toEqual({
      massReindexRequired: false,
      reasons: [],
      topic: 'search.rebuild-items.v1',
    });
    expect(await outbox(created.id)).toEqual([]);

    const loud = await repository.updateDefinition(created.id, quiet.definition.version, {
      visibility: 'public',
      searchable: true,
      filterable: true,
      sortable: true,
      labels: { en: 'Reindexed', uk: 'Перебудовано' },
    });
    expect(loud.reindex).toEqual({
      massReindexRequired: true,
      reasons: ['visibility', 'searchable', 'filterable', 'sortable', 'labels'],
      topic: 'search.rebuild-items.v1',
    });
    const messages = await outbox(created.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      topic: 'search.rebuild-items.v1',
      deduplication_key: `field-definition-changed:${created.id}:v${loud.definition.version}`,
    });
    expect(messages[0]!.payload_json).toMatchObject({
      event: 'FieldDefinitionChanged',
      payloadVersion: 1,
      fieldKey: 'reindexed',
      scope: 'item',
      reasons: ['visibility', 'searchable', 'filterable', 'sortable', 'labels'],
    });

    const archived = await repository.archiveDefinition(created.id, loud.definition.version);
    expect(archived.reindex.reasons).toEqual(['archived']);
    expect(await outbox(created.id)).toHaveLength(2);
    await expect(
      repository.archiveDefinition(created.id, archived.definition.version),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_NOT_FOUND' });
  });

  it('manages options through the parent definition version and resolves archived options', async () => {
    const materials = await repository.createDefinition(
      definitionInput({ key: 'materials', dataType: 'multiselect' }),
    );
    const withMetal = await repository.createOption(materials.id, materials.version, {
      key: 'metal',
      labels: { en: 'Metal', uk: 'Метал' },
      displayOrder: 1,
    });
    expect(withMetal.version).toBe(2);
    expect(withMetal.options.map((option) => option.key)).toEqual(['metal']);
    const withPlastic = await repository.createOption(materials.id, withMetal.version, {
      key: 'plastic',
      labels: { en: 'Plastic', uk: 'Пластик' },
      displayOrder: 2,
    });
    await expect(
      repository.createOption(materials.id, materials.version, {
        key: 'wood',
        labels: { en: 'Wood' },
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_VERSION_CONFLICT' });
    // Creating an option adds no existing value, so no rebuild is enqueued.
    expect(await outbox(materials.id)).toEqual([]);

    const metalId = withPlastic.options.find((option) => option.key === 'metal')!.id;
    const renamed = await repository.updateOption(materials.id, metalId, withPlastic.version, {
      labels: { en: 'Steel', uk: 'Сталь' },
    });
    expect(renamed.options.find((option) => option.key === 'metal')?.labels).toEqual({
      en: 'Steel',
      uk: 'Сталь',
    });
    const optionMessages = await outbox(metalId);
    expect(optionMessages).toHaveLength(1);
    expect(optionMessages[0]!.payload_json).toMatchObject({
      event: 'FieldOptionLabelChanged',
      payloadVersion: 1,
      optionKey: 'metal',
      fieldKey: 'materials',
    });
    const reordered = await repository.updateOption(materials.id, metalId, renamed.version, {
      displayOrder: 9,
    });
    expect(await outbox(metalId)).toHaveLength(1);

    const archived = await repository.archiveOption(materials.id, metalId, reordered.version);
    expect(archived.options.find((option) => option.id === metalId)?.archivedAt).toEqual(now);
    expect(
      (await repository.listDefinitions({ scope: 'item' }))
        .find((definition) => definition.id === materials.id)
        ?.options.map((option) => option.key),
    ).toEqual(['plastic']);
    // Archived options remain resolvable for historical values.
    expect(
      (await repository.findDefinitionById(materials.id))?.options.map((option) => option.key),
    ).toEqual(['plastic', 'metal']);
    await expect(
      repository.archiveOption(materials.id, metalId, archived.version),
    ).rejects.toMatchObject({ code: 'SCHEMA_OPTION_NOT_FOUND' });
  });

  it('accepts options only for select and multiselect definitions', async () => {
    const text = await repository.createDefinition(definitionInput({ key: 'plain_text' }));
    await expect(
      repository.createOption(text.id, text.version, { key: 'metal', labels: { en: 'Metal' } }),
    ).rejects.toMatchObject({ code: 'SCHEMA_OPTION_NOT_SUPPORTED' });
    const select = await repository.createDefinition(
      definitionInput({ key: 'condition', dataType: 'select' }),
    );
    await expect(
      repository.createOption(select.id, select.version, { key: 'New', labels: { en: 'New' } }),
    ).rejects.toMatchObject({ code: 'SCHEMA_OPTION_INVALID_KEY' });
    await expect(
      repository.updateOption(select.id, randomUUID(), select.version, {
        labels: { en: 'Used' },
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_OPTION_NOT_FOUND' });
  });

  it('changes the data type directly only while no value exists', async () => {
    const field = await repository.createDefinition(
      definitionInput({ key: 'convertible', dataType: 'text' }),
    );
    const converted = await repository.updateDefinition(field.id, field.version, {
      dataType: 'long_text',
    });
    expect(converted.definition.dataType).toBe('long_text');
    await expect(
      repository.updateDefinition(converted.definition.id, converted.definition.version, {
        dataType: 'reference',
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_CONVERSION_UNSUPPORTED' });

    await prisma.attributeValue.create({
      data: {
        id: randomUUID(),
        fieldDefinitionId: field.id,
        itemId: await createFixtureItem(),
        position: 0,
        valueText: '42',
        createdAt: now,
        updatedAt: now,
      },
    });
    await expect(
      repository.updateDefinition(converted.definition.id, converted.definition.version, {
        dataType: 'number',
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_CONVERSION_REQUIRED' });
    // Everything unrelated to the data type still updates normally.
    await expect(
      repository.updateDefinition(converted.definition.id, converted.definition.version, {
        displayOrder: 2,
      }),
    ).resolves.toMatchObject({ definition: { displayOrder: 2, dataType: 'long_text' } });
  });

  it('requires archived options before leaving an option data type', async () => {
    const select = await repository.createDefinition(
      definitionInput({ key: 'leaving_options', dataType: 'select' }),
    );
    const withOption = await repository.createOption(select.id, select.version, {
      key: 'new',
      labels: { en: 'New' },
    });
    await expect(
      repository.updateDefinition(select.id, withOption.version, { dataType: 'text' }),
    ).rejects.toMatchObject({ code: 'SCHEMA_FIELD_CONVERSION_UNSUPPORTED' });
    const multi = await repository.updateDefinition(select.id, withOption.version, {
      dataType: 'multiselect',
    });
    expect(multi.definition.options).toHaveLength(1);
    const archived = await repository.archiveOption(
      select.id,
      withOption.options[0]!.id,
      multi.definition.version,
    );
    await expect(
      repository.updateDefinition(select.id, archived.version, { dataType: 'text' }),
    ).resolves.toMatchObject({ definition: { dataType: 'text' } });
  });

  it('previews a conversion with counts and issue codes but never a stored value', async () => {
    const field = await repository.createDefinition(
      definitionInput({ key: 'previewed', dataType: 'text' }),
    );
    const itemId = randomUUID();
    await createFixtureItem(itemId);
    for (const [position, valueText] of ['12.5', 'not-a-number', '2026-09-09'].entries()) {
      await prisma.attributeValue.create({
        data: {
          id: randomUUID(),
          fieldDefinitionId: field.id,
          itemId,
          position,
          valueText,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    const toNumber = await repository.previewTypeConversion(field.id, 'number');
    expect(toNumber).toMatchObject({
      fieldKey: 'previewed',
      currentDataType: 'text',
      targetDataType: 'number',
      supported: true,
      lossless: false,
      totalValues: 3,
      analyzedValues: 3,
      convertibleValues: 1,
      blockingValues: 2,
      truncated: false,
      requiresBackgroundConversion: true,
      reindexRequired: true,
    });
    expect(toNumber.blockingIssues).toEqual(['INVALID_NUMBER']);
    expect(JSON.stringify(toNumber)).not.toContain('not-a-number');

    const toLongText = await repository.previewTypeConversion(field.id, 'long_text');
    expect(toLongText).toMatchObject({
      supported: true,
      lossless: true,
      convertibleValues: 3,
      blockingValues: 0,
    });
    const toSelect = await repository.previewTypeConversion(field.id, 'select');
    expect(toSelect).toMatchObject({
      supported: false,
      lossless: false,
      blockingValues: 3,
      requiresBackgroundConversion: false,
      blockingIssues: ['TYPE_MISMATCH'],
    });
    await expect(repository.previewTypeConversion(field.id, 'integer')).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_INVALID_DATA_TYPE',
    });
    await expect(repository.previewTypeConversion(randomUUID(), 'text')).rejects.toMatchObject({
      code: 'SCHEMA_FIELD_NOT_FOUND',
    });
  });

  it('rolls back the definition, audit and outbox writes together', async () => {
    const failing: OutboxPort = {
      enqueue: async () => {
        throw new Error('outbox unavailable');
      },
    };
    const brittle = new FieldDefinitionRepository(prisma, () => now, undefined, failing);
    const created = await repository.createDefinition(definitionInput({ key: 'rolled_back' }));
    await expect(
      brittle.updateDefinition(created.id, created.version, { visibility: 'public' }),
    ).rejects.toThrow('outbox unavailable');
    const unchanged = await repository.findDefinitionById(created.id);
    expect(unchanged).toMatchObject({ visibility: 'authenticated', version: 1 });
    expect(await outbox(created.id)).toEqual([]);
    expect((await audits(created.id)).map((event) => event.action)).toEqual([
      'schema.field-definition.created',
    ]);
    // The working repository still commits audit and outbox in the same transaction.
    const outboxPort: OutboxPort = new TransactionalOutboxPort();
    const healthy = new FieldDefinitionRepository(prisma, () => now, undefined, outboxPort);
    await healthy.updateDefinition(created.id, created.version, { visibility: 'public' });
    expect(await outbox(created.id)).toHaveLength(1);
  });
});
