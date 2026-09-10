import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor, type SessionActor } from '../auth/index.js';
import { createDatabase, migrateToLatest } from '../database.js';
import {
  IdempotencyRepository,
  TransactionalAuditPort,
  TransactionalIdempotencyPort,
  TransactionalMovementHistoryPort,
  TransactionalOutboxPort,
  TransactionalSearchProjectionPort,
  type OutboxPort,
} from '../infrastructure/index.js';
import { TransactionalAttributeValuePort } from '../schema/attribute-value-port.js';
import { FieldDefinitionRepository } from '../schema/field-definition-repository.js';
import { createSettingsClient } from '../settings.repository.js';
import { CatalogDictionaryRepository } from './dictionary-repository.js';
import { CatalogDictionaryService } from './dictionary-service.js';
import { ItemRepository } from './item-repository.js';
import { ItemService, ItemVersionConflictError, type CreatedItem } from './item-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `item_service_${randomUUID().replaceAll('-', '')}`;
const instant = new Date('2026-09-10T12:00:00.000Z');
let adminPool: Pool;
let pool: Pool;
let database: ReturnType<typeof createDatabase>;
let prisma: ReturnType<typeof createSettingsClient>;
let service: ItemService;
let actor: SessionActor;
let categoryId: string;
let lifecycleStatusId: string;

const updateSchema = `item_update_${randomUUID().replaceAll('-', '')}`;
let updateAdminPool: Pool;
let updatePool: Pool;
let updateDatabase: ReturnType<typeof createDatabase>;
let updatePrisma: ReturnType<typeof createSettingsClient>;
let updateService: ItemService;
let editor: SessionActor;
let admin: SessionActor;
let updateCategoryId: string;
let updateStatusId: string;

suite('CAT-03B atomic Item creation', () => {
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
    database = createDatabase(schemaUrl, 2);
    prisma = createSettingsClient(schemaUrl, 4);
    const actorId = randomUUID();
    await prisma.user.create({
      data: {
        id: actorId,
        emailNormalized: 'editor@example.test',
        displayName: 'Synthetic Editor',
        passwordHash: '$argon2id$synthetic',
        role: 'editor',
      },
    });
    actor = {
      id: actorId,
      email: 'editor@example.test',
      displayName: 'Synthetic Editor',
      locale: 'uk',
      role: 'editor',
      permissions: permissionsFor('editor'),
    };
    categoryId = (
      await prisma.category.create({
        data: {
          id: randomUUID(),
          key: 'tools',
          labelI18n: { en: 'Tools', uk: 'Інструменти' },
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    lifecycleStatusId = (
      await prisma.lifecycleStatus.create({
        data: {
          id: randomUUID(),
          key: 'stored',
          labelI18n: { en: 'Stored', uk: 'Зберігається' },
          colorToken: 'status.info',
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    await prisma.fieldDefinition.createMany({
      data: [
        {
          id: randomUUID(),
          key: 'serial_number',
          scope: 'item',
          categoryId,
          labelI18n: { en: 'Serial number', uk: 'Серійний номер' },
          dataType: 'text',
          required: true,
          searchable: true,
          filterable: true,
          visibility: 'public',
          createdAt: instant,
          updatedAt: instant,
        },
        {
          id: randomUUID(),
          key: 'owner_note',
          scope: 'item',
          categoryId,
          labelI18n: { en: 'Owner note', uk: 'Нотатка власника' },
          dataType: 'text',
          searchable: true,
          visibility: 'private',
          createdAt: instant,
          updatedAt: instant,
        },
      ],
    });
    service = createService();
  });

  afterAll(async () => {
    await database?.destroy();
    await pool?.end();
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('commits core, typed values, safe projection, audit, outbox and idempotency together', async () => {
    const input = {
      categoryId,
      lifecycleStatusId,
      displayName: '  Дриль  ',
      visibility: 'public' as const,
      tags: ['Power tools'],
      attributes: { serial_number: 'SN-42', owner_note: 'private shelf detail' },
    };
    const first = await service.create(actor, input, {
      idempotencyKey: 'create-drill',
      requestId: 'request-create-drill',
      correlationId: 'correlation-create-drill',
    });
    const replay = await service.create(actor, input, { idempotencyKey: 'create-drill' });

    expect(replay).toEqual({ ...first, replayed: true });
    expect(first.item).toMatchObject({ displayName: 'Дриль', version: 1 });
    expect((await pool.query('select count(*)::int as count from items')).rows[0]).toEqual({
      count: 1,
    });
    expect(
      (await pool.query('select count(*)::int as count from attribute_values')).rows[0],
    ).toEqual({ count: 2 });
    const projection = (
      await pool.query(
        `select display_name, attrs, public_attrs,
                search_vector::text as search_vector, public_search_vector::text as public_search_vector
           from item_search`,
      )
    ).rows[0];
    expect(projection).toMatchObject({
      display_name: 'Дриль',
      attrs: { serial_number: 'SN-42' },
      public_attrs: { serial_number: 'SN-42' },
    });
    expect(projection.search_vector).not.toContain('private');
    expect(projection.public_search_vector).not.toContain('private');
    const audit = (await pool.query('select after_json from audit_events')).rows[0].after_json;
    expect(JSON.stringify(audit)).not.toContain('private shelf detail');
    expect((await pool.query('select topic from outbox')).rows).toEqual([
      { topic: 'catalog.item-created.v1' },
    ]);
    expect(
      (
        await pool.query('select state from idempotency_records where scope = $1', [
          'catalog.items.create',
        ])
      ).rows,
    ).toContainEqual({ state: 'completed' });

    await expect(
      service.create(
        actor,
        { ...input, displayName: 'Different' },
        { idempotencyKey: 'create-drill' },
      ),
    ).rejects.toMatchObject({ code: 'ITEM_IDEMPOTENCY_CONFLICT' });
  });

  it('rolls every source-transaction write back when a transaction-aware port fails', async () => {
    const before = Number((await pool.query('select count(*) as count from items')).rows[0].count);
    const failingOutbox: OutboxPort = {
      async enqueue() {
        throw new Error('synthetic outbox failure');
      },
    };
    await expect(
      createService(failingOutbox).create(
        actor,
        {
          categoryId,
          lifecycleStatusId,
          displayName: 'Rollback Item',
          attributes: { serial_number: 'ROLLBACK-1' },
        },
        { idempotencyKey: 'rollback-item' },
      ),
    ).rejects.toThrow('synthetic outbox failure');
    expect(Number((await pool.query('select count(*) as count from items')).rows[0].count)).toBe(
      before,
    );
    expect(
      (
        await pool.query(
          "select count(*)::int as count from item_search where display_name = 'Rollback Item'",
        )
      ).rows[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await pool.query(
          "select count(*)::int as count from audit_events where after_json->>'publicId' is not null",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select state from idempotency_records where scope = 'catalog.items.create' and state = 'failed'",
        )
      ).rows,
    ).toContainEqual({ state: 'failed' });
  });

  it('returns the stable field key and rolls back when a required attribute is missing', async () => {
    const before = Number((await pool.query('select count(*) as count from items')).rows[0].count);
    await expect(
      service.create(
        actor,
        { categoryId, lifecycleStatusId, displayName: 'Missing serial' },
        { idempotencyKey: 'missing-serial' },
      ),
    ).rejects.toMatchObject({ issues: [{ fieldKey: 'serial_number', code: 'REQUIRED' }] });
    expect(Number((await pool.query('select count(*) as count from items')).rows[0].count)).toBe(
      before,
    );
  });

  it('rejects a Viewer before reserving a key or opening the Item transaction', async () => {
    const viewer: SessionActor = {
      ...actor,
      role: 'viewer',
      permissions: permissionsFor('viewer'),
    };
    const beforeItems = Number(
      (await pool.query('select count(*) as count from items')).rows[0].count,
    );
    const beforeKeys = Number(
      (await pool.query('select count(*) as count from idempotency_records')).rows[0].count,
    );
    await expect(
      service.create(
        viewer,
        {
          categoryId,
          lifecycleStatusId,
          displayName: 'Forbidden Item',
          attributes: { serial_number: 'NOPE' },
        },
        { idempotencyKey: 'viewer-create' },
      ),
    ).rejects.toMatchObject({ code: 'ITEM_CREATE_FORBIDDEN' });
    expect(Number((await pool.query('select count(*) as count from items')).rows[0].count)).toBe(
      beforeItems,
    );
    expect(
      Number((await pool.query('select count(*) as count from idempotency_records')).rows[0].count),
    ).toBe(beforeKeys);
  });

  it('reports a live reservation and safely reclaims its expired lease', async () => {
    let now = instant;
    const repository = new IdempotencyRepository(
      database,
      () => now,
      randomUUID,
      () => randomUUID(),
    );
    const request = {
      actorId: actor.id,
      scope: 'catalog.lease-test',
      key: 'lease-key',
      fingerprint: 'a'.repeat(64),
    };
    expect((await repository.reserve(request)).kind).toBe('acquired');
    expect((await repository.reserve(request)).kind).toBe('in_progress');
    now = new Date(instant.getTime() + 31_000);
    expect((await repository.reserve(request)).kind).toBe('acquired');
  });
});

function createService(outbox: OutboxPort = new TransactionalOutboxPort()): ItemService {
  return new ItemService(
    new ItemRepository(prisma, randomUUID, () => instant),
    new IdempotencyRepository(database, () => instant),
    new FieldDefinitionRepository(prisma, () => instant),
    {
      attributes: new TransactionalAttributeValuePort(),
      audit: new TransactionalAuditPort(),
      idempotency: new TransactionalIdempotencyPort(),
      movements: new TransactionalMovementHistoryPort(),
      outbox,
      search: new TransactionalSearchProjectionPort(),
    },
    new CatalogDictionaryRepository(prisma, () => instant),
    () => instant,
  );
}

suite('CAT-04 Item edit with optimistic concurrency', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    updateAdminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await updateAdminPool.query(`create schema "${updateSchema}"`);
    parsed.searchParams.set('options', `-c search_path=${updateSchema}`);
    parsed.searchParams.set('schema', updateSchema);
    const schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    updatePool = new Pool({ connectionString: schemaUrl, max: 2 });
    updateDatabase = createDatabase(schemaUrl, 2);
    updatePrisma = createSettingsClient(schemaUrl, 4);
    const editorId = randomUUID();
    const adminId = randomUUID();
    await updatePrisma.user.createMany({
      data: [
        {
          id: editorId,
          emailNormalized: 'editor@example.test',
          displayName: 'Synthetic Editor',
          passwordHash: '$argon2id$synthetic',
          role: 'editor',
        },
        {
          id: adminId,
          emailNormalized: 'admin@example.test',
          displayName: 'Synthetic Admin',
          passwordHash: '$argon2id$synthetic',
          role: 'admin',
        },
      ],
    });
    editor = {
      id: editorId,
      email: 'editor@example.test',
      displayName: 'Synthetic Editor',
      locale: 'en',
      role: 'editor',
      permissions: permissionsFor('editor'),
    };
    admin = {
      id: adminId,
      email: 'admin@example.test',
      displayName: 'Synthetic Admin',
      locale: 'en',
      role: 'admin',
      permissions: permissionsFor('admin'),
    };
    updateCategoryId = (
      await updatePrisma.category.create({
        data: {
          id: randomUUID(),
          key: 'tools',
          labelI18n: { en: 'Tools', uk: 'Інструменти' },
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    updateStatusId = (
      await updatePrisma.lifecycleStatus.create({
        data: {
          id: randomUUID(),
          key: 'stored',
          labelI18n: { en: 'Stored', uk: 'Зберігається' },
          colorToken: 'status.info',
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    await updatePrisma.fieldDefinition.createMany({
      data: [
        {
          id: randomUUID(),
          key: 'serial_number',
          scope: 'item',
          categoryId: updateCategoryId,
          labelI18n: { en: 'Serial number', uk: 'Серійний номер' },
          dataType: 'text',
          required: true,
          searchable: true,
          visibility: 'public',
          createdAt: instant,
          updatedAt: instant,
        },
        {
          id: randomUUID(),
          key: 'owner_note',
          scope: 'item',
          categoryId: updateCategoryId,
          labelI18n: { en: 'Owner note', uk: 'Нотатка власника' },
          dataType: 'text',
          searchable: true,
          visibility: 'private',
          createdAt: instant,
          updatedAt: instant,
        },
      ],
    });
    updateService = createUpdateService();
  });

  afterAll(async () => {
    await updateDatabase?.destroy();
    await updatePool?.end();
    await updatePrisma?.$disconnect();
    if (updateAdminPool) {
      await updateAdminPool.query(`drop schema "${updateSchema}" cascade`);
      await updateAdminPool.end();
    }
  });

  it('increments the version and commits source, projection, audit and outbox together', async () => {
    const created = await createSubject('increment', 'Дриль', 'SN-1');
    const outcome = await updateService.update(
      admin,
      created.publicId,
      created.version,
      { displayName: 'Дриль 2', attributes: { serial_number: 'SN-2' } },
      { requestId: 'request-update', correlationId: 'correlation-update' },
    );

    expect(outcome).toMatchObject({
      replayed: false,
      status: 200,
      item: { displayName: 'Дриль 2', version: created.version + 1 },
      invalidators: ['AttributeChanged'],
    });
    const row = (
      await updatePool.query('select version, display_name from items where public_id = $1', [
        created.publicId,
      ])
    ).rows[0];
    expect(Number(row.version)).toBe(2);
    expect(row.display_name).toBe('Дриль 2');
    const projection = (
      await updatePool.query(
        `select display_name, attrs, public_attrs from item_search
           where item_id = (select id from items where public_id = $1)`,
        [created.publicId],
      )
    ).rows[0];
    expect(projection).toMatchObject({
      display_name: 'Дриль 2',
      attrs: { serial_number: 'SN-2' },
      public_attrs: {},
    });
    expect(
      (
        await updatePool.query(
          "select topic, payload_json from outbox where topic = 'catalog.item-updated.v1'",
        )
      ).rows,
    ).toContainEqual({
      topic: 'catalog.item-updated.v1',
      payload_json: {
        publicId: created.publicId,
        version: 2,
        invalidators: ['AttributeChanged'],
      },
    });
    const audit = (
      await updatePool.query(
        "select before_json, after_json from audit_events where action = 'item.updated'",
      )
    ).rows[0];
    expect(audit.before_json).toMatchObject({ version: 1 });
    expect(audit.after_json).toMatchObject({ version: 2, attributeKeys: ['serial_number'] });
    expect(JSON.stringify(audit)).not.toContain('SN-2');
  });

  it('increments the version when only an attribute changes', async () => {
    const created = await createSubject('attribute-only', 'Ключ', 'SN-A');
    const outcome = await updateService.update(admin, created.publicId, created.version, {
      attributes: { serial_number: 'SN-B' },
    });
    expect(outcome.item.version).toBe(created.version + 1);
    expect(outcome.invalidators).toEqual(['AttributeChanged']);
  });

  it('registers ItemVisibilityChanged and clears the public projection', async () => {
    const created = await createSubject('visibility', 'Видимість', 'SN-V', 'public');
    const outcome = await updateService.update(admin, created.publicId, created.version, {
      visibility: 'private',
    });
    expect(outcome.invalidators).toEqual(['ItemVisibilityChanged']);
    const projection = (
      await updatePool.query(
        `select visibility, attrs, public_attrs, public_search_vector::text as public_vector
           from item_search where item_id = (select id from items where public_id = $1)`,
        [created.publicId],
      )
    ).rows[0];
    expect(projection).toMatchObject({ visibility: 'private', attrs: {}, public_attrs: {} });
    expect(projection.public_vector).toBe('');
  });

  it('rejects a stale expected version with the current version and a safe diff', async () => {
    const created = await createSubject('conflict', 'Конфлікт', 'SN-C');
    await updateService.update(admin, created.publicId, created.version, {
      displayName: 'Concurrent winner',
    });

    const conflict = await updateService
      .update(admin, created.publicId, created.version, {
        displayName: 'Late loser',
        attributes: { serial_number: 'SN-LATE' },
      })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(ItemVersionConflictError);
    expect(conflict).toMatchObject({
      code: 'ITEM_VERSION_CONFLICT',
      currentVersion: created.version + 1,
      safeDiff: {
        displayName: { current: 'Concurrent winner', submitted: 'Late loser' },
        'attributes.serial_number': { current: 'SN-C', submitted: 'SN-LATE' },
      },
    });
    expect(
      (
        await updatePool.query('select display_name from items where public_id = $1', [
          created.publicId,
        ])
      ).rows[0].display_name,
    ).toBe('Concurrent winner');
  });

  it('excludes a private field from the conflict diff of an actor who cannot view it', async () => {
    const created = await createSubject('private-diff', 'Приватне', 'SN-P');
    await updateService.update(admin, created.publicId, created.version, {
      attributes: { serial_number: 'SN-P', owner_note: 'private shelf detail' },
    });

    const conflict = await updateService
      .update(editor, created.publicId, created.version, {
        displayName: 'Editor rename',
        attributes: { serial_number: 'SN-EDITOR' },
      })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(ItemVersionConflictError);
    const safeDiff = (conflict as ItemVersionConflictError).safeDiff;
    expect(safeDiff).toHaveProperty('attributes.serial_number');
    expect(safeDiff).not.toHaveProperty('attributes.owner_note');
    expect(JSON.stringify(safeDiff)).not.toContain('private shelf detail');
  });

  it('keeps a private value an Editor cannot see instead of erasing it', async () => {
    const created = await createSubject('private-keep', 'Збереження', 'SN-K');
    const withPrivate = await updateService.update(admin, created.publicId, created.version, {
      attributes: { serial_number: 'SN-K', owner_note: 'private shelf detail' },
    });

    await updateService.update(editor, created.publicId, withPrivate.item.version, {
      attributes: { serial_number: 'SN-K2' },
    });

    const stored = (
      await updatePool.query(
        `select definition.key, value.value_text from attribute_values value
           join field_definitions definition on definition.id = value.field_definition_id
           where value.item_id = (select id from items where public_id = $1)
           order by definition.key`,
        [created.publicId],
      )
    ).rows;
    expect(stored).toEqual([
      { key: 'owner_note', value_text: 'private shelf detail' },
      { key: 'serial_number', value_text: 'SN-K2' },
    ]);
    const detail = await updateService.get(editor, created.publicId);
    expect(detail.attributes).toEqual({ serial_number: 'SN-K2' });
    expect(await updateService.get(admin, created.publicId)).toMatchObject({
      attributes: { serial_number: 'SN-K2', owner_note: 'private shelf detail' },
    });
  });

  it('rolls the whole update back when a transaction-aware port fails', async () => {
    const created = await createSubject('rollback', 'Відкат', 'SN-R');
    const failingOutbox: OutboxPort = {
      async enqueue() {
        throw new Error('synthetic outbox failure');
      },
    };
    await expect(
      createUpdateService(failingOutbox).update(admin, created.publicId, created.version, {
        displayName: 'Never committed',
        attributes: { serial_number: 'SN-ROLLBACK' },
      }),
    ).rejects.toThrow('synthetic outbox failure');

    const row = (
      await updatePool.query('select version, display_name from items where public_id = $1', [
        created.publicId,
      ])
    ).rows[0];
    expect(Number(row.version)).toBe(created.version);
    expect(row.display_name).toBe('Відкат');
    expect(
      (
        await updatePool.query(
          `select value_text from attribute_values
             where item_id = (select id from items where public_id = $1)`,
          [created.publicId],
        )
      ).rows,
    ).toEqual([{ value_text: 'SN-R' }]);
  });

  it('replays a retried idempotent update instead of incrementing the version twice', async () => {
    const created = await createSubject('retry', 'Повтор', 'SN-RETRY');
    const change = { displayName: 'Повтор 2' };
    const first = await updateService.update(admin, created.publicId, created.version, change, {
      idempotencyKey: 'update-retry',
    });
    const replay = await updateService.update(admin, created.publicId, created.version, change, {
      idempotencyKey: 'update-retry',
    });

    expect(first).toMatchObject({ replayed: false, status: 200 });
    expect(replay).toMatchObject({ replayed: true, status: 200, item: first.item });
    expect(
      Number(
        (
          await updatePool.query('select version from items where public_id = $1', [
            created.publicId,
          ])
        ).rows[0].version,
      ),
    ).toBe(created.version + 1);
    await expect(
      updateService.update(
        admin,
        created.publicId,
        created.version,
        { displayName: 'Different' },
        { idempotencyKey: 'update-retry' },
      ),
    ).rejects.toMatchObject({ code: 'ITEM_IDEMPOTENCY_CONFLICT' });
  });

  it('refuses a Viewer and reports an unknown Item without leaking its existence', async () => {
    const created = await createSubject('authorization', 'Дозволи', 'SN-Z');
    const viewer: SessionActor = {
      ...editor,
      role: 'viewer',
      permissions: permissionsFor('viewer'),
    };
    await expect(
      updateService.update(viewer, created.publicId, created.version, { displayName: 'Nope' }),
    ).rejects.toMatchObject({ code: 'ITEM_UPDATE_FORBIDDEN' });
    await expect(
      updateService.update(admin, randomUUID(), 1, { displayName: 'Nope' }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    await expect(
      updateService.update(admin, created.publicId, 0, { displayName: 'Nope' }),
    ).rejects.toMatchObject({ code: 'ITEM_EXPECTED_VERSION_INVALID' });
  });

  it('hides a private Item from an actor without viewPrivateFields', async () => {
    const created = await createSubject('private-item', 'Прихований', 'SN-H');
    await updateService.update(admin, created.publicId, created.version, {
      visibility: 'private',
    });
    await expect(updateService.get(editor, created.publicId)).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    });
    expect(await updateService.get(admin, created.publicId)).toMatchObject({
      visibility: 'private',
    });
  });

  describe('CAT-05 rendered display names', () => {
    let templateCategoryId: string;
    let dictionaryService: CatalogDictionaryService;

    beforeAll(async () => {
      templateCategoryId = (
        await updatePrisma.category.create({
          data: {
            id: randomUUID(),
            key: 'cameras',
            labelI18n: { en: 'Cameras', uk: 'Фотокамери' },
            createdAt: instant,
            updatedAt: instant,
          },
        })
      ).id;
      await updatePrisma.fieldDefinition.createMany({
        data: [
          {
            id: randomUUID(),
            key: 'brand',
            scope: 'item',
            categoryId: templateCategoryId,
            labelI18n: { en: 'Brand', uk: 'Бренд' },
            dataType: 'text',
            searchable: true,
            visibility: 'public',
            createdAt: instant,
            updatedAt: instant,
          },
          {
            id: randomUUID(),
            key: 'model',
            scope: 'item',
            categoryId: templateCategoryId,
            labelI18n: { en: 'Model', uk: 'Модель' },
            dataType: 'text',
            visibility: 'public',
            createdAt: instant,
            updatedAt: instant,
          },
          {
            id: randomUUID(),
            key: 'secret_note',
            scope: 'item',
            categoryId: templateCategoryId,
            labelI18n: { en: 'Secret note', uk: 'Таємна нотатка' },
            dataType: 'text',
            visibility: 'private',
            createdAt: instant,
            updatedAt: instant,
          },
        ],
      });
      dictionaryService = new CatalogDictionaryService(
        new CatalogDictionaryRepository(updatePrisma, () => instant),
        new FieldDefinitionRepository(updatePrisma, () => instant),
      );
      await setTemplate('{{category}} {{brand}} {{model}}');
    });

    async function setTemplate(displayTemplate: string | null): Promise<void> {
      const current = await dictionaryService.resolveCategory(admin, templateCategoryId);
      await dictionaryService.updateCategory(admin, templateCategoryId, current!.version, {
        displayTemplate,
      });
    }

    async function createCamera(
      key: string,
      attributes: Record<string, unknown>,
      suppliedName = 'Typed by the editor',
    ): Promise<CreatedItem> {
      const outcome = await updateService.create(
        admin,
        {
          categoryId: templateCategoryId,
          lifecycleStatusId: updateStatusId,
          displayName: suppliedName,
          attributes,
        },
        { idempotencyKey: `camera-${key}` },
      );
      return outcome.item;
    }

    it('derives the stored name from the template instead of the submitted name', async () => {
      const created = await createCamera('derive', { brand: 'Pentax', model: 'LX' });
      expect(created.displayName).toBe('Cameras Pentax LX');
      const row = (
        await updatePool.query('select display_name, slug from items where public_id = $1', [
          created.publicId,
        ])
      ).rows[0];
      expect(row.display_name).toBe('Cameras Pentax LX');
      expect(row.slug).toBe('cameras-pentax-lx');
      expect(
        (
          await updatePool.query(
            'select display_name from item_search where item_id = (select id from items where public_id = $1)',
            [created.publicId],
          )
        ).rows[0].display_name,
      ).toBe('Cameras Pentax LX');
    });

    it('rebuilds the name when a referenced value changes and keeps the public ID', async () => {
      const created = await createCamera('rebuild', { brand: 'Pentax', model: 'LX' });
      const before = (
        await updatePool.query('select id, public_id, slug from items where public_id = $1', [
          created.publicId,
        ])
      ).rows[0];

      const updated = await updateService.update(admin, created.publicId, created.version, {
        attributes: { brand: 'Nikon', model: 'F3' },
      });

      expect(updated.item.displayName).toBe('Cameras Nikon F3');
      expect(updated.invalidators).toEqual(['AttributeChanged']);
      const after = (
        await updatePool.query(
          'select id, public_id, slug, display_name from items where public_id = $1',
          [created.publicId],
        )
      ).rows[0];
      expect(after.display_name).toBe('Cameras Nikon F3');
      expect({ id: after.id, public_id: after.public_id, slug: after.slug }).toEqual(before);
      expect(
        (
          await updatePool.query('select display_name from item_search where item_id = $1', [
            after.id,
          ])
        ).rows[0].display_name,
      ).toBe('Cameras Nikon F3');
    });

    it('skips missing tokens and keeps the submitted name when nothing renders', async () => {
      const partial = await createCamera('partial', { brand: 'Pentax' });
      expect(partial.displayName).toBe('Cameras Pentax');

      await setTemplate('{{brand}} - {{model}}');
      const empty = await createCamera('empty', {}, 'Untitled camera');
      expect(empty.displayName).toBe('Untitled camera');
      const dangling = await createCamera('dangling', { model: 'LX' });
      expect(dangling.displayName).toBe('LX');
      await setTemplate('{{category}} {{brand}} {{model}}');
    });

    it('keeps the submitted name when the category has no template', async () => {
      const item = await updateService.create(
        admin,
        {
          categoryId: updateCategoryId,
          lifecycleStatusId: updateStatusId,
          displayName: 'Plain name',
          attributes: { serial_number: 'SN-PLAIN' },
        },
        { idempotencyKey: 'camera-no-template' },
      );
      expect(item.item.displayName).toBe('Plain name');
    });

    it('renders the preview with the same output the Item stores', async () => {
      const preview = await dictionaryService.previewCategoryDisplayName(
        admin,
        templateCategoryId,
        '{{category}} {{brand}} {{model}}',
        { brand: 'Pentax', model: 'LX' },
      );
      const created = await createCamera('preview-parity', { brand: 'Pentax', model: 'LX' });
      expect(preview.rendered.en).toBe(created.displayName);
      expect(preview.rendered.uk).toBe('Фотокамери Pentax LX');
      expect(preview.missingTokens).toEqual([]);
      expect(preview.tokens.map((token) => token.key)).toEqual(['category', 'brand', 'model']);
    });

    it('refuses a template that names a private field, an unknown key, or JavaScript', async () => {
      const current = await dictionaryService.resolveCategory(admin, templateCategoryId);
      for (const template of ['{{secret_note}}', '{{nope}}', '{{brand}}<script>x</script>']) {
        await expect(
          dictionaryService.updateCategory(admin, templateCategoryId, current!.version, {
            displayTemplate: template,
          }),
        ).rejects.toMatchObject({ name: 'DisplayTemplateError' });
      }
      expect(
        (
          await updatePool.query('select display_template from categories where id = $1', [
            templateCategoryId,
          ])
        ).rows[0].display_template,
      ).toBe('{{category}} {{brand}} {{model}}');
    });

    it('enqueues one category rebuild message when the template changes', async () => {
      await updatePool.query("delete from outbox where topic = 'search.rebuild-items.v1'");
      await setTemplate('{{brand}} {{model}}');
      const messages = (
        await updatePool.query(
          "select payload_json from outbox where topic = 'search.rebuild-items.v1'",
        )
      ).rows;
      expect(messages).toHaveLength(1);
      expect(messages[0].payload_json).toMatchObject({
        event: 'CategoryRenamed',
        categoryId: templateCategoryId,
        reasons: ['display_template'],
        rebuildsDisplayNames: true,
      });
      await setTemplate('{{category}} {{brand}} {{model}}');
    });
  });
});

async function createSubject(
  key: string,
  displayName: string,
  serialNumber: string,
  visibility: 'public' | 'authenticated' = 'authenticated',
): Promise<CreatedItem> {
  const outcome = await updateService.create(
    admin,
    {
      categoryId: updateCategoryId,
      lifecycleStatusId: updateStatusId,
      displayName,
      visibility,
      attributes: { serial_number: serialNumber },
    },
    { idempotencyKey: `create-${key}` },
  );
  return outcome.item;
}

function createUpdateService(outbox: OutboxPort = new TransactionalOutboxPort()): ItemService {
  return new ItemService(
    new ItemRepository(updatePrisma, randomUUID, () => instant),
    new IdempotencyRepository(updateDatabase, () => instant),
    new FieldDefinitionRepository(updatePrisma, () => instant),
    {
      attributes: new TransactionalAttributeValuePort(),
      audit: new TransactionalAuditPort(),
      idempotency: new TransactionalIdempotencyPort(),
      movements: new TransactionalMovementHistoryPort(),
      outbox,
      search: new TransactionalSearchProjectionPort(),
    },
    new CatalogDictionaryRepository(updatePrisma, () => instant),
    () => instant,
  );
}
