import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, currentSchemaVersion, expectedSchemaVersion } from '../database.js';

const suite = process.env.INTEGRATION_DATABASE_URL ? describe : describe.skip;
const schema = `dynamic_schema_${randomUUID().replaceAll('-', '')}`;
const migrationFolder = fileURLToPath(new URL('../../../../db/migrations', import.meta.url));
const createdAt = new Date('2026-09-09T10:00:00.000Z');
let admin: Pool;
let pool: Pool;
let database: ReturnType<typeof createDatabase>;
let migrator: Migrator;
let categoryId: string;
let lifecycleStatusId: string;

async function ensureItem(id: string): Promise<void> {
  await pool.query(
    `insert into items (
       id, public_id, slug, category_id, lifecycle_status_id, display_name, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'Schema fixture item', $6, $6)
     on conflict (id) do nothing`,
    [
      id,
      randomUUID(),
      `fixture-${id.replaceAll('-', '')}`,
      categoryId,
      lifecycleStatusId,
      createdAt,
    ],
  );
}

// Only synthetic fixture identifiers enter SQL; values are always bound parameters.
async function insert(
  table: 'categories' | 'field_definitions' | 'field_options' | 'attribute_values',
  values: Record<string, unknown>,
) {
  if (table === 'attribute_values') {
    if (typeof values.item_id === 'string') await ensureItem(values.item_id);
    if (typeof values.value_reference_item_id === 'string')
      await ensureItem(values.value_reference_item_id);
  }
  const entries = Object.entries(values);
  const columns = entries.map(([key]) => `"${key.replaceAll('"', '""')}"`).join(', ');
  const parameters = entries.map((_, index) => `$${index + 1}`).join(', ');
  return pool.query(
    `insert into "${table}" (${columns}) values (${parameters}) returning *`,
    entries.map(([, value]) => value),
  );
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    key: `field_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    scope: 'item',
    label_i18n: { en: 'Serial number', uk: 'Серійний номер' },
    data_type: 'text',
    ...overrides,
  };
}

function option(fieldDefinitionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    field_definition_id: fieldDefinitionId,
    key: `option_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    label_i18n: { en: 'Metal', uk: 'Метал' },
    ...overrides,
  };
}

function value(fieldDefinitionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    field_definition_id: fieldDefinitionId,
    item_id: randomUUID(),
    position: 0,
    value_text: 'SN-000-DEMO',
    ...overrides,
  };
}

suite('CAT-02 dynamic schema on PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL!);
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`create schema "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    database = createDatabase(url.toString(), 1);
    migrator = new Migrator({
      db: database,
      migrationTableSchema: schema,
      provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe(expectedSchemaVersion);
    categoryId = (
      await insert('categories', {
        id: randomUUID(),
        key: 'electronics',
        label_i18n: { en: 'Electronics', uk: 'Електроніка' },
      })
    ).rows[0].id;
    lifecycleStatusId = (
      await pool.query(
        `insert into lifecycle_statuses (id, key, label_i18n, color_token)
         values ($1, 'stored', '{"en":"Stored"}', 'status.info') returning id`,
        [randomUUID()],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await database?.destroy();
    if (admin) {
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  });

  it('defaults definitions to safe flags, authenticated visibility and version 1', async () => {
    const { rows } = await insert('field_definitions', definition());
    expect(rows[0]).toMatchObject({
      required: false,
      repeatable: false,
      searchable: false,
      filterable: false,
      sortable: false,
      visibility: 'authenticated',
      unit: null,
      default_value_json: null,
      validation_json: {},
      display_order: 0,
      archived_at: null,
      version: '1',
      category_id: null,
    });
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].updated_at).toBeInstanceOf(Date);
  });

  it('accepts every approved data type, scope and visibility', async () => {
    const dataTypes = [
      'text',
      'long_text',
      'number',
      'boolean',
      'date',
      'datetime',
      'select',
      'multiselect',
      'url',
      'email',
      'money',
      'reference',
    ];
    for (const data_type of dataTypes) {
      for (const scope of ['item', 'storage_node']) {
        expect((await insert('field_definitions', definition({ data_type, scope }))).rowCount).toBe(
          1,
        );
      }
    }
    for (const visibility of ['public', 'authenticated', 'private']) {
      expect((await insert('field_definitions', definition({ visibility }))).rowCount).toBe(1);
    }
  });

  it.each([
    ['key', 'Serial'],
    ['key', '1serial'],
    ['key', ''],
    ['scope', 'node'],
    ['data_type', 'integer'],
    ['data_type', 'decimal'],
    ['visibility', 'unlisted'],
    ['label_i18n', { uk: 'Серійний номер' }],
    ['label_i18n', { en: '  ' }],
    ['label_i18n', { en: 'Serial', uk: '' }],
    ['label_i18n', { en: 'Serial', de: 'Serie' }],
    ['label_i18n', '"Serial"'],
    ['help_i18n', { uk: 'Підказка' }],
    ['help_i18n', '[]'],
    ['unit', ' '],
    ['validation_json', '[]'],
    ['validation_json', '3'],
    ['display_order', -1],
    ['version', 0],
  ])('rejects invalid field definition %s: %j', async (column, invalid) => {
    await expect(
      insert('field_definitions', definition({ [column]: invalid })),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each(['select', 'multiselect'])(
    'rejects repeatable = true for %s definitions',
    async (kind) => {
      await expect(
        insert('field_definitions', definition({ data_type: kind, repeatable: true })),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (await insert('field_definitions', definition({ data_type: kind, repeatable: false })))
          .rowCount,
      ).toBe(1);
      expect(
        (await insert('field_definitions', definition({ data_type: 'text', repeatable: true })))
          .rowCount,
      ).toBe(1);
    },
  );

  it('keeps active keys unique per scope and category while allowing archived reuse', async () => {
    const key = 'serial_number';
    expect((await insert('field_definitions', definition({ key }))).rowCount).toBe(1);
    await expect(insert('field_definitions', definition({ key }))).rejects.toMatchObject({
      code: '23505',
    });
    // A category-scoped definition is a different applicability and stays allowed.
    const scoped = await insert('field_definitions', definition({ key, category_id: categoryId }));
    expect(scoped.rowCount).toBe(1);
    await expect(
      insert('field_definitions', definition({ key, category_id: categoryId })),
    ).rejects.toMatchObject({ code: '23505' });
    // The same key in the other scope, and a reuse after archiving, are both allowed.
    expect(
      (await insert('field_definitions', definition({ key, scope: 'storage_node' }))).rowCount,
    ).toBe(1);
    await pool.query('update field_definitions set archived_at = now() where id = $1', [
      scoped.rows[0].id,
    ]);
    expect(
      (await insert('field_definitions', definition({ key, category_id: categoryId }))).rowCount,
    ).toBe(1);
  });

  it('rejects definition key and scope changes even outside the repository', async () => {
    const { rows } = await insert('field_definitions', definition());
    await expect(
      pool.query('update field_definitions set key = $2 where id = $1', [
        rows[0].id,
        'renamed_key',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('update field_definitions set scope = $2 where id = $1', [
        rows[0].id,
        'storage_node',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query('update field_definitions set label_i18n = $2 where id = $1 returning *', [
          rows[0].id,
          { en: 'Renamed' },
        ])
      ).rows[0].label_i18n,
    ).toEqual({ en: 'Renamed' });
  });

  it('restricts deleting a category or definition that dynamic schema rows still reference', async () => {
    const scoped = await insert('field_definitions', definition({ category_id: categoryId }));
    await expect(
      pool.query('delete from categories where id = $1', [categoryId]),
    ).rejects.toMatchObject({ code: '23001' });
    await insert('field_options', option(scoped.rows[0].id));
    await expect(
      pool.query('delete from field_definitions where id = $1', [scoped.rows[0].id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('keeps active option keys unique per definition and identity immutable', async () => {
    const first = await insert('field_definitions', definition({ data_type: 'multiselect' }));
    const second = await insert('field_definitions', definition({ data_type: 'multiselect' }));
    const metal = await insert('field_options', option(first.rows[0].id, { key: 'metal' }));
    expect(metal.rows[0]).toMatchObject({ display_order: 0, archived_at: null });
    await expect(
      insert('field_options', option(first.rows[0].id, { key: 'metal' })),
    ).rejects.toMatchObject({ code: '23505' });
    // The same option key under a different definition is a different option.
    expect(
      (await insert('field_options', option(second.rows[0].id, { key: 'metal' }))).rowCount,
    ).toBe(1);
    await expect(
      pool.query('update field_options set key = $2 where id = $1', [metal.rows[0].id, 'steel']),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('update field_options set field_definition_id = $2 where id = $1', [
        metal.rows[0].id,
        second.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query('update field_options set archived_at = now() where id = $1', [
      metal.rows[0].id,
    ]);
    expect(
      (await insert('field_options', option(first.rows[0].id, { key: 'metal' }))).rowCount,
    ).toBe(1);
  });

  it.each([
    ['no owner', { item_id: null }],
    ['both owners', { storage_node_id: randomUUID() }],
  ])('requires exactly one attribute owner: %s', async (_case, overrides) => {
    const field = await insert('field_definitions', definition());
    await expect(
      insert('attribute_values', value(field.rows[0].id, overrides)),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires exactly one populated typed value group', async () => {
    const field = await insert('field_definitions', definition());
    await expect(
      insert('attribute_values', value(field.rows[0].id, { value_text: null })),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('attribute_values', value(field.rows[0].id, { value_boolean: true })),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('attribute_values', value(field.rows[0].id, { value_text: '  ' })),
    ).rejects.toMatchObject({ code: '23514' });
    for (const slot of [
      { value_number: '12.5' },
      { value_boolean: false },
      { value_date: '2026-09-09' },
      { value_datetime: createdAt },
      { value_money_amount: '10.5000', value_money_currency: 'UAH' },
      { value_reference_item_id: randomUUID() },
      { value_reference_node_id: randomUUID() },
    ]) {
      expect(
        (await insert('attribute_values', value(field.rows[0].id, { value_text: null, ...slot })))
          .rowCount,
      ).toBe(1);
    }
  });

  it('requires money amount and currency together and rejects malformed currencies', async () => {
    const field = await insert('field_definitions', definition({ data_type: 'money' }));
    for (const money of [
      { value_money_amount: '10.5000' },
      { value_money_currency: 'UAH' },
      { value_money_amount: '10.5000', value_money_currency: 'uah' },
      { value_money_amount: '10.5000', value_money_currency: 'U1H' },
    ]) {
      await expect(
        insert('attribute_values', value(field.rows[0].id, { value_text: null, ...money })),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('requires non-negative positions unique per owner, field and position', async () => {
    const field = await insert('field_definitions', definition({ repeatable: true }));
    const itemId = randomUUID();
    const nodeId = randomUUID();
    await expect(
      insert('attribute_values', value(field.rows[0].id, { position: -1 })),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (await insert('attribute_values', value(field.rows[0].id, { item_id: itemId, position: 0 })))
        .rowCount,
    ).toBe(1);
    expect(
      (await insert('attribute_values', value(field.rows[0].id, { item_id: itemId, position: 1 })))
        .rowCount,
    ).toBe(1);
    await expect(
      insert('attribute_values', value(field.rows[0].id, { item_id: itemId, position: 1 })),
    ).rejects.toMatchObject({ code: '23505' });
    // The same position under a different owner is a different row.
    expect(
      (
        await insert(
          'attribute_values',
          value(field.rows[0].id, { item_id: null, storage_node_id: nodeId, position: 0 }),
        )
      ).rowCount,
    ).toBe(1);
  });

  it('persists multiselect as ordered option rows and rejects wrong-field options and duplicates', async () => {
    const materials = await insert('field_definitions', definition({ data_type: 'multiselect' }));
    const other = await insert('field_definitions', definition({ data_type: 'multiselect' }));
    const metal = await insert('field_options', option(materials.rows[0].id, { key: 'metal' }));
    const plastic = await insert('field_options', option(materials.rows[0].id, { key: 'plastic' }));
    const foreign = await insert('field_options', option(other.rows[0].id, { key: 'wood' }));
    const itemId = randomUUID();
    const selection = (position: number, valueOptionId: string) =>
      value(materials.rows[0].id, {
        item_id: itemId,
        position,
        value_text: null,
        value_option_id: valueOptionId,
      });

    expect((await insert('attribute_values', selection(0, metal.rows[0].id))).rowCount).toBe(1);
    expect((await insert('attribute_values', selection(1, plastic.rows[0].id))).rowCount).toBe(1);
    await expect(insert('attribute_values', selection(2, metal.rows[0].id))).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      insert('attribute_values', selection(2, foreign.rows[0].id)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(insert('attribute_values', selection(2, randomUUID()))).rejects.toMatchObject({
      code: '23503',
    });
    const stored = await pool.query(
      'select "position", value_option_id from attribute_values where item_id = $1 order by "position"',
      [itemId],
    );
    expect(stored.rows).toEqual([
      { position: 0, value_option_id: metal.rows[0].id },
      { position: 1, value_option_id: plastic.rows[0].id },
    ]);
    // Selected options are protected while a value still references them.
    await expect(
      pool.query('delete from field_options where id = $1', [metal.rows[0].id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('stores no array-shaped column for any dynamic value', async () => {
    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns
         where table_schema = $1 and table_name = 'attribute_values'
         and (data_type = 'ARRAY' or udt_name like '\\_%')`,
      [schema],
    );
    expect(rows).toEqual([]);
  });

  it('indexes the dynamic schema and attribute access paths', async () => {
    const indexes = (
      await pool.query('select indexname from pg_indexes where schemaname = $1', [schema])
    ).rows.map((row) => row.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'field_definitions_category_key_idx',
        'field_definitions_scope_key_idx',
        'field_definitions_scope_order_idx',
        'field_definitions_category_idx',
        'field_options_active_key_idx',
        'field_options_order_idx',
        'attribute_values_item_position_idx',
        'attribute_values_node_position_idx',
        'attribute_values_item_option_idx',
        'attribute_values_node_option_idx',
        'attribute_values_definition_idx',
        'attribute_values_option_idx',
      ]),
    );
  });

  it('gains real owner foreign keys as soon as items and storage_nodes exist', async () => {
    const owners = [
      { table: 'items', columns: ['item_id', 'value_reference_item_id'] },
      { table: 'storage_nodes', columns: ['storage_node_id', 'value_reference_node_id'] },
    ];
    for (const owner of owners) {
      const present = await pool.query('select to_regclass($1) as relation', [
        `${schema}.${owner.table}`,
      ]);
      if (!present.rows[0].relation) continue;
      const { rows } = await pool.query(
        `select distinct key.column_name from information_schema.table_constraints constraint_row
           join information_schema.key_column_usage key
             on key.constraint_name = constraint_row.constraint_name
            and key.constraint_schema = constraint_row.constraint_schema
           join information_schema.constraint_column_usage target
             on target.constraint_name = constraint_row.constraint_name
            and target.constraint_schema = constraint_row.constraint_schema
          where constraint_row.constraint_schema = $1
            and constraint_row.table_name = 'attribute_values'
            and constraint_row.constraint_type = 'FOREIGN KEY'
            and target.table_name = $2`,
        [schema, owner.table],
      );
      expect(rows.map((row) => row.column_name).toSorted()).toEqual(owner.columns.toSorted());
    }
  });

  it('rolls back the dynamic schema and reapplies cleanly', async () => {
    // Roll back every migration layered above the dynamic schema first.
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe('0006_item_aggregate');
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe('0005_dynamic_schema');
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe('0004_outbox');
    expect(
      (
        await pool.query(
          `select to_regclass('field_definitions') as definitions,
                  to_regclass('field_options') as options,
                  to_regclass('attribute_values') as values,
                  to_regclass('categories') as categories,
                  to_regprocedure('reject_schema_identity_change()') as trigger_function`,
        )
      ).rows[0],
    ).toMatchObject({
      definitions: null,
      options: null,
      values: null,
      categories: 'categories',
      trigger_function: null,
    });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe(expectedSchemaVersion);
  });
});
