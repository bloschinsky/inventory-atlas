import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { seedLifecycleStatuses } from '../seed.js';
import { CatalogDictionaryRepository } from './dictionary-repository.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `catalog_dictionary_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-09-09T10:00:00.000Z');
let adminPool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let repository: CatalogDictionaryRepository;

suite('CAT-01 catalog dictionaries on PostgreSQL', () => {
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
    prisma = createSettingsClient(schemaUrl, 4);
    repository = new CatalogDictionaryRepository(prisma, () => now);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('seeds the approved bilingual lifecycle keys idempotently without overwriting edits', async () => {
    expect(await seedLifecycleStatuses(prisma)).toBe(7);
    await prisma.lifecycleStatus.update({
      where: { key: 'stored' },
      data: { labelI18n: { en: 'Kept', uk: 'Збережено' } },
    });
    expect(await seedLifecycleStatuses(prisma)).toBe(0);
    expect((await repository.listLifecycleStatuses()).map(({ key }) => key)).toEqual([
      'stored',
      'reserved',
      'lent',
      'for_sale',
      'sold',
      'lost',
      'archived',
    ]);
    expect((await repository.findLifecycleStatusByKey('stored'))?.labels).toEqual({
      en: 'Kept',
      uk: 'Збережено',
    });
  });

  it('creates ordered bilingual categories and rejects archived or cyclic parents', async () => {
    const root = await repository.createCategory({
      key: 'tools',
      labels: { en: 'Tools', uk: 'Інструменти' },
      displayOrder: 20,
    });
    const child = await repository.createCategory({
      key: 'hand_tools',
      labels: { en: 'Hand tools' },
      parentId: root.id,
      displayOrder: 10,
    });
    await expect(
      repository.updateCategory(root.id, 1, { parentId: child.id }),
    ).rejects.toMatchObject({ code: 'CATALOG_CATEGORY_PARENT_INVALID' });
    const archived = await repository.archiveCategory(child.id, 1);
    expect(archived).toMatchObject({ key: 'hand_tools', version: 2, archivedAt: now });
    await expect(
      repository.createCategory({
        key: 'wrenches',
        labels: { en: 'Wrenches' },
        parentId: child.id,
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_CATEGORY_PARENT_INVALID' });
    expect((await repository.listCategories()).map(({ key }) => key)).toEqual(['tools']);
    expect((await repository.findCategoryByKey('hand_tools'))?.archivedAt).toEqual(now);
  });

  it('renames labels while preserving keys and enforcing optimistic versions', async () => {
    const created = await repository.createLifecycleStatus({
      key: 'repairing',
      labels: { en: 'Repairing', uk: 'У ремонті' },
      colorToken: 'status.warning',
      displayOrder: 35,
    });
    const updated = await repository.updateLifecycleStatus(created.id, 1, {
      labels: { en: 'Being repaired', uk: 'Ремонтується' },
      displayOrder: 36,
    });
    expect(updated).toMatchObject({ key: 'repairing', version: 2, displayOrder: 36 });
    await expect(
      repository.updateLifecycleStatus(created.id, 1, { displayOrder: 37 }),
    ).rejects.toMatchObject({ code: 'CATALOG_DICTIONARY_VERSION_CONFLICT' });
    await expect(
      repository.updateLifecycleStatus(created.id, 2, {
        // Runtime payloads still cannot smuggle a replacement key past TypeScript.
        key: 'fixed',
      } as never),
    ).rejects.toMatchObject({ code: 'CATALOG_DICTIONARY_KEY_IMMUTABLE' });
  });

  it('enforces key, label, order, version and immutable-key rules in PostgreSQL', async () => {
    const id = randomUUID();
    await expect(
      adminPool.query(
        `insert into "${schema}".categories
          (id, key, label_i18n, display_order) values ($1::uuid, $2, $3::jsonb, $4)`,
        [id, 'Invalid-Key', JSON.stringify({ en: 'Invalid' }), 0],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      adminPool.query(
        `insert into "${schema}".categories
          (id, key, label_i18n, display_order) values ($1::uuid, $2, $3::jsonb, $4)`,
        [randomUUID(), 'missing_english', JSON.stringify({ uk: 'Немає англійської' }), 0],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    for (const [key, displayOrder, version] of [
      ['negative_order', -1, 1],
      ['invalid_version', 0, 0],
    ] as const) {
      await expect(
        adminPool.query(
          `insert into "${schema}".categories
            (id, key, label_i18n, display_order, version)
            values ($1::uuid, $2, $3::jsonb, $4, $5)`,
          [randomUUID(), key, JSON.stringify({ en: 'Invalid' }), displayOrder, version],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const category = await repository.createCategory({
      key: 'immutable',
      labels: { en: 'Immutable' },
      displayOrder: 0,
    });
    await expect(
      adminPool.query(`update "${schema}".categories set key = $1 where id = $2::uuid`, [
        'changed',
        category.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    const child = await repository.createCategory({
      key: 'cycle_child',
      labels: { en: 'Cycle child' },
      parentId: category.id,
      displayOrder: 0,
    });
    await expect(
      adminPool.query(`update "${schema}".categories set parent_id = $1 where id = $2::uuid`, [
        child.id,
        category.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
