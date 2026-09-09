import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import {
  FieldDefinitionRepository,
  type CreateFieldDefinitionInput,
} from './field-definition-repository.js';
import {
  TransactionalAttributeValuePort,
  type AttributeOwner,
  type AttributeValueAssignment,
} from './attribute-value-port.js';
import type { CanonicalFieldValue, FieldScope } from './field-policy.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `attribute_values_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-09-09T10:00:00.000Z');
const referencedItemId = '40000000-0000-4000-8000-000000000001';
let adminPool: Pool;
let pool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let database: ReturnType<typeof createDatabase>;
let repository: FieldDefinitionRepository;
let port: TransactionalAttributeValuePort;
/** Field ids keyed by `${scope}:${key}` so both source clients replace an identical schema. */
const fields = new Map<string, string>();
const options = new Map<string, string>();

function fieldId(scope: FieldScope, key: string): string {
  return fields.get(`${scope}:${key}`)!;
}

function optionId(scope: FieldScope, key: string): string {
  return options.get(`${scope}:${key}`)!;
}

async function storedRows(owner: AttributeOwner): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `select definition.key as field_key, value."position", value.value_text, value.value_number,
            value.value_boolean, value.value_date, value.value_datetime, value.value_money_amount,
            value.value_money_currency, value.value_reference_item_id, value.value_reference_node_id,
            option.key as option_key
       from attribute_values value
       join field_definitions definition on definition.id = value.field_definition_id
       left join field_options option on option.id = value.value_option_id
       where value.item_id is not distinct from $1::uuid
         and value.storage_node_id is not distinct from $2::uuid
       order by definition.key, value."position"`,
    [owner.kind === 'item' ? owner.id : null, owner.kind === 'storageNode' ? owner.id : null],
  );
  return rows;
}

/** The same logical assignment expressed for one scope, so both branches write the same rows. */
function assignments(scope: FieldScope): AttributeValueAssignment[] {
  const text = (value: string): CanonicalFieldValue => ({ slot: 'text', text: value });
  return [
    { fieldDefinitionId: fieldId(scope, 'quantity'), values: [{ slot: 'number', number: '17' }] },
    { fieldDefinitionId: fieldId(scope, 'serial_number'), values: [text('SN-000-DEMO')] },
    { fieldDefinitionId: fieldId(scope, 'notes'), values: [text('line one\nline two')] },
    {
      fieldDefinitionId: fieldId(scope, 'author'),
      values: [text('Taras Shevchenko'), text('Ivan Franko')],
    },
    {
      fieldDefinitionId: fieldId(scope, 'is_fragile'),
      values: [{ slot: 'boolean', boolean: true }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'purchased_at'),
      values: [{ slot: 'date', date: '2026-09-09' }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'checked_at'),
      values: [{ slot: 'datetime', datetime: '2026-09-09T10:00:00.000Z' }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'homepage'),
      values: [text('https://example.test/router')],
    },
    { fieldDefinitionId: fieldId(scope, 'contact'), values: [text('owner@example.test')] },
    {
      fieldDefinitionId: fieldId(scope, 'price'),
      values: [{ slot: 'money', amount: '1250.5', currency: 'UAH' }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'related'),
      values: [{ slot: 'referenceItem', itemId: referencedItemId }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'condition'),
      values: [{ slot: 'option', optionId: optionId(scope, 'used') }],
    },
    {
      fieldDefinitionId: fieldId(scope, 'materials'),
      values: [
        { slot: 'option', optionId: optionId(scope, 'metal') },
        { slot: 'option', optionId: optionId(scope, 'plastic') },
      ],
    },
  ];
}

async function seedScope(scope: FieldScope): Promise<void> {
  const definitions: [string, Partial<CreateFieldDefinitionInput>][] = [
    ['quantity', { dataType: 'number', required: true, validation: { min: 0, integer: true } }],
    ['serial_number', { dataType: 'text', validation: { maxLength: 32 } }],
    ['notes', { dataType: 'long_text' }],
    ['author', { dataType: 'text', repeatable: true }],
    ['is_fragile', { dataType: 'boolean' }],
    ['purchased_at', { dataType: 'date' }],
    ['checked_at', { dataType: 'datetime' }],
    ['homepage', { dataType: 'url' }],
    ['contact', { dataType: 'email' }],
    ['price', { dataType: 'money', validation: { currencies: ['UAH', 'EUR'] } }],
    ['related', { dataType: 'reference' }],
    ['condition', { dataType: 'select' }],
    ['materials', { dataType: 'multiselect', validation: { maxSelected: 2 } }],
    ['unused_optional', { dataType: 'text' }],
  ];
  for (const [key, overrides] of definitions) {
    const created = await repository.createDefinition({
      ...overrides,
      key,
      scope,
      labels: { en: key, uk: `${key}-uk` },
      dataType: overrides.dataType,
    });
    fields.set(`${scope}:${key}`, created.id);
  }
  const optionKeys: [string, string[]][] = [
    ['condition', ['new', 'used', 'broken']],
    ['materials', ['metal', 'plastic', 'wood']],
  ];
  for (const [field, keys] of optionKeys) {
    let version = 1;
    for (const [index, key] of keys.entries()) {
      const definition = await repository.createOption(fieldId(scope, field), version, {
        key,
        labels: { en: key, uk: `${key}-uk` },
        displayOrder: index,
      });
      version = definition.version;
      options.set(`${scope}:${key}`, definition.options.find((option) => option.key === key)!.id);
    }
  }
  // `broken` and `wood` stay archived so newly selected archived options are rejected.
  for (const [field, key] of [
    ['condition', 'broken'],
    ['materials', 'wood'],
  ] as [string, string][]) {
    const current = (await repository.findDefinitionById(fieldId(scope, field)))!;
    await repository.archiveOption(current.id, optionId(scope, key), current.version);
  }
}

suite('CAT-02 attribute value port parity on PostgreSQL', () => {
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
    database = createDatabase(schemaUrl, 2);
    repository = new FieldDefinitionRepository(prisma, () => now);
    port = new TransactionalAttributeValuePort();
    await seedScope('item');
    await seedScope('storage_node');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await prisma?.$disconnect();
    await database?.destroy();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('writes identical typed rows from a Prisma source and a Kysely source', async () => {
    const itemOwner: AttributeOwner = { kind: 'item', id: randomUUID() };
    const nodeOwner: AttributeOwner = { kind: 'storageNode', id: randomUUID() };
    await prisma.$transaction(async (transaction) =>
      port.replace(
        { kind: 'prisma', trx: transaction },
        { owner: itemOwner, categoryId: null, assignments: assignments('item'), now },
      ),
    );
    await database
      .transaction()
      .execute(async (transaction) =>
        port.replace(
          { kind: 'kysely', trx: transaction },
          { owner: nodeOwner, categoryId: null, assignments: assignments('storage_node'), now },
        ),
      );

    const item = await storedRows(itemOwner);
    const node = await storedRows(nodeOwner);
    expect(item).toHaveLength(15);
    expect(item).toEqual(node);
    expect(item.map((row) => [row.field_key, row.position, row.option_key ?? null])).toEqual([
      ['author', 0, null],
      ['author', 1, null],
      ['checked_at', 0, null],
      ['condition', 0, 'used'],
      ['contact', 0, null],
      ['homepage', 0, null],
      ['is_fragile', 0, null],
      ['materials', 0, 'metal'],
      ['materials', 1, 'plastic'],
      ['notes', 0, null],
      ['price', 0, null],
      ['purchased_at', 0, null],
      ['quantity', 0, null],
      ['related', 0, null],
      ['serial_number', 0, null],
    ]);
    expect(item.find((row) => row.field_key === 'price')).toMatchObject({
      value_money_amount: '1250.5000',
      value_money_currency: 'UAH',
    });
    expect(item.find((row) => row.field_key === 'quantity')?.value_number).toBe('17.0000000000');
    expect(item.find((row) => row.field_key === 'related')).toMatchObject({
      value_reference_item_id: referencedItemId,
      value_reference_node_id: null,
    });
    expect(item.find((row) => row.field_key === 'unused_optional')).toBeUndefined();
  });

  it('projects stored values back through the Prisma-owned read path', async () => {
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    await prisma.$transaction(async (transaction) =>
      port.replace(
        { kind: 'prisma', trx: transaction },
        { owner, categoryId: null, assignments: assignments('item'), now },
      ),
    );
    const groups = await repository.readAttributeValues(owner);
    const materials = groups.find((group) => group.definition.key === 'materials')!;
    expect(materials.values).toEqual([
      { slot: 'option', optionId: optionId('item', 'metal') },
      { slot: 'option', optionId: optionId('item', 'plastic') },
    ]);
    expect(groups.find((group) => group.definition.key === 'author')?.values).toEqual([
      { slot: 'text', text: 'Taras Shevchenko' },
      { slot: 'text', text: 'Ivan Franko' },
    ]);
    expect(groups.find((group) => group.definition.key === 'price')?.values).toEqual([
      { slot: 'money', amount: '1250.5', currency: 'UAH' },
    ]);
  });

  it('replaces the complete owner set and leaves other owners untouched', async () => {
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    const other: AttributeOwner = { kind: 'item', id: randomUUID() };
    for (const target of [owner, other]) {
      await prisma.$transaction(async (transaction) =>
        port.replace(
          { kind: 'prisma', trx: transaction },
          { owner: target, categoryId: null, assignments: assignments('item'), now },
        ),
      );
    }
    await prisma.$transaction(async (transaction) =>
      port.replace(
        { kind: 'prisma', trx: transaction },
        {
          owner,
          categoryId: null,
          assignments: [
            {
              fieldDefinitionId: fieldId('item', 'quantity'),
              values: [{ slot: 'number', number: '2' }],
            },
          ],
          now,
        },
      ),
    );
    expect((await storedRows(owner)).map((row) => row.field_key)).toEqual(['quantity']);
    expect(await storedRows(other)).toHaveLength(15);
  });

  it('rejects invalid assignments and rolls the whole source transaction back', async () => {
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    const quantity = fieldId('item', 'quantity');
    const cases: [string, AttributeValueAssignment[], string][] = [
      ['missing required field', [], 'quantity:REQUIRED'],
      [
        'wrong-field option',
        [
          { fieldDefinitionId: quantity, values: [{ slot: 'number', number: '1' }] },
          {
            fieldDefinitionId: fieldId('item', 'materials'),
            values: [{ slot: 'option', optionId: optionId('item', 'used') }],
          },
        ],
        'materials:UNKNOWN_OPTION',
      ],
      [
        'archived option',
        [
          { fieldDefinitionId: quantity, values: [{ slot: 'number', number: '1' }] },
          {
            fieldDefinitionId: fieldId('item', 'materials'),
            values: [{ slot: 'option', optionId: optionId('item', 'wood') }],
          },
        ],
        'materials:ARCHIVED_OPTION',
      ],
      [
        'definition from the other scope',
        [
          { fieldDefinitionId: quantity, values: [{ slot: 'number', number: '1' }] },
          {
            fieldDefinitionId: fieldId('storage_node', 'serial_number'),
            values: [{ slot: 'text', text: 'SN' }],
          },
        ],
        `${fieldId('storage_node', 'serial_number')}:UNKNOWN_FIELD`,
      ],
      [
        'value outside its validation range',
        [{ fieldDefinitionId: quantity, values: [{ slot: 'number', number: '-1' }] }],
        'quantity:OUT_OF_RANGE',
      ],
      [
        'more selected options than allowed',
        [
          { fieldDefinitionId: quantity, values: [{ slot: 'number', number: '1' }] },
          {
            fieldDefinitionId: fieldId('item', 'materials'),
            values: [
              { slot: 'option', optionId: optionId('item', 'metal') },
              { slot: 'option', optionId: optionId('item', 'plastic') },
              { slot: 'option', optionId: optionId('item', 'metal') },
            ],
          },
        ],
        'materials:DUPLICATE_OPTION',
      ],
    ];
    for (const [name, invalid, expected] of cases) {
      await expect(
        prisma.$transaction(async (transaction) =>
          port.replace(
            { kind: 'prisma', trx: transaction },
            { owner, categoryId: null, assignments: invalid, now },
          ),
        ),
        name,
      ).rejects.toMatchObject({
        code: 'SCHEMA_ATTRIBUTE_VALIDATION_FAILED',
        issues: expect.arrayContaining([
          { fieldKey: expected.split(':')[0], code: expected.split(':')[1] },
        ]),
      });
      expect(await storedRows(owner), name).toEqual([]);
    }
  });

  it('rolls attribute rows back with the source transaction from either client', async () => {
    const itemOwner: AttributeOwner = { kind: 'item', id: randomUUID() };
    const nodeOwner: AttributeOwner = { kind: 'storageNode', id: randomUUID() };
    await expect(
      prisma.$transaction(async (transaction) => {
        await port.replace(
          { kind: 'prisma', trx: transaction },
          { owner: itemOwner, categoryId: null, assignments: assignments('item'), now },
        );
        throw new Error('source mutation failed');
      }),
    ).rejects.toThrow('source mutation failed');
    await expect(
      database.transaction().execute(async (transaction) => {
        await port.replace(
          { kind: 'kysely', trx: transaction },
          { owner: nodeOwner, categoryId: null, assignments: assignments('storage_node'), now },
        );
        throw new Error('node mutation failed');
      }),
    ).rejects.toThrow('node mutation failed');
    expect(await storedRows(itemOwner)).toEqual([]);
    expect(await storedRows(nodeOwner)).toEqual([]);
  });

  it('applies category applicability when resolving the writable schema', async () => {
    const category = await prisma.category.create({
      data: {
        id: randomUUID(),
        key: `category_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        labelI18n: { en: 'Books', uk: 'Книги' },
        createdAt: now,
        updatedAt: now,
      },
    });
    const scoped = await repository.createDefinition({
      key: 'isbn',
      scope: 'item',
      categoryId: category.id,
      labels: { en: 'ISBN', uk: 'ISBN' },
      dataType: 'text',
    });
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    const assignment: AttributeValueAssignment[] = [
      { fieldDefinitionId: fieldId('item', 'quantity'), values: [{ slot: 'number', number: '1' }] },
      { fieldDefinitionId: scoped.id, values: [{ slot: 'text', text: '978-0000000000' }] },
    ];
    await expect(
      prisma.$transaction(async (transaction) =>
        port.replace(
          { kind: 'prisma', trx: transaction },
          { owner, categoryId: null, assignments: assignment, now },
        ),
      ),
    ).rejects.toMatchObject({
      issues: [{ fieldKey: scoped.id, code: 'UNKNOWN_FIELD' }],
    });
    await prisma.$transaction(async (transaction) =>
      port.replace(
        { kind: 'prisma', trx: transaction },
        { owner, categoryId: category.id, assignments: assignment, now },
      ),
    );
    expect((await storedRows(owner)).map((row) => row.field_key)).toEqual(['isbn', 'quantity']);
  });

  it('rejects an archived definition and requires a value for every required field', async () => {
    const archived = await repository.createDefinition({
      key: 'retired_field',
      scope: 'item',
      labels: { en: 'Retired', uk: 'Скасовано' },
      dataType: 'text',
    });
    await repository.archiveDefinition(archived.id, archived.version);
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    await expect(
      prisma.$transaction(async (transaction) =>
        port.replace(
          { kind: 'prisma', trx: transaction },
          {
            owner,
            categoryId: null,
            assignments: [
              {
                fieldDefinitionId: fieldId('item', 'quantity'),
                values: [{ slot: 'number', number: '1' }],
              },
              { fieldDefinitionId: archived.id, values: [{ slot: 'text', text: 'value' }] },
            ],
            now,
          },
        ),
      ),
    ).rejects.toMatchObject({ issues: [{ fieldKey: archived.id, code: 'UNKNOWN_FIELD' }] });
  });

  it('stores no array-shaped value for a multiselect field', async () => {
    const owner: AttributeOwner = { kind: 'item', id: randomUUID() };
    await prisma.$transaction(async (transaction) =>
      port.replace(
        { kind: 'prisma', trx: transaction },
        { owner, categoryId: null, assignments: assignments('item'), now },
      ),
    );
    const { rows } = await pool.query(
      `select count(*)::integer as rows from attribute_values
         where item_id = $1 and field_definition_id = $2 and value_option_id is not null`,
      [owner.id, fieldId('item', 'materials')],
    );
    expect(rows[0].rows).toBe(2);
    const arrays = await pool.query(
      `select column_name from information_schema.columns
         where table_schema = $1 and table_name = 'attribute_values' and data_type = 'ARRAY'`,
      [schema],
    );
    expect(arrays.rows).toEqual([]);
  });
});
