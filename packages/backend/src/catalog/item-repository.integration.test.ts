import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { ItemRepository } from './item-repository.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `item_repository_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-09-10T10:00:00.000Z');
let adminPool: Pool;
let pool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let repository: ItemRepository;
let categoryId: string;
let lifecycleStatusId: string;

suite('CAT-03 Item repository on PostgreSQL', () => {
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
    prisma = createSettingsClient(schemaUrl, 3);
    repository = new ItemRepository(prisma, randomUUID, () => now);
    categoryId = (
      await prisma.category.create({
        data: {
          id: randomUUID(),
          key: 'electronics',
          labelI18n: { en: 'Electronics' },
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

  it('creates stable UUID identity, a decorative slug, tags and version one', async () => {
    const created = await repository.transaction(async (transaction) => {
      const item = await repository.createCore(transaction, {
        categoryId,
        lifecycleStatusId,
        displayName: 'Café Router',
        description: '  Main router  ',
        visibility: 'public',
      });
      await repository.replaceTags(transaction, item.id, [' Network ', 'network', 'Spare']);
      return item;
    });

    expect(created).toMatchObject({
      slug: 'cafe-router',
      description: 'Main router',
      visibility: 'public',
      version: 1,
    });
    expect(created.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(await repository.findByPublicId(created.publicId)).toEqual(created);
    expect(
      (await pool.query('select name_normalized from tags order by name_normalized')).rows,
    ).toEqual([{ name_normalized: 'network' }, { name_normalized: 'spare' }]);

    await expect(
      pool.query('update items set public_id = $2 where id = $1', [created.id, randomUUID()]),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query('update items set slug = $2 where id = $1', [created.id, 'renamed-router']);
    expect((await repository.findByPublicId(created.publicId))?.slug).toBe('renamed-router');
  });

  it('rolls Item and tag writes back with the supplied Prisma transaction', async () => {
    const before = await prisma.item.count();
    await expect(
      repository.transaction(async (transaction) => {
        const item = await repository.createCore(transaction, {
          categoryId,
          lifecycleStatusId,
          displayName: 'Rollback fixture',
        });
        await repository.replaceTags(transaction, item.id, ['rolled back']);
        throw new Error('rollback requested');
      }),
    ).rejects.toThrow('rollback requested');
    expect(await prisma.item.count()).toBe(before);
    expect(await prisma.tag.findUnique({ where: { nameNormalized: 'rolled back' } })).toBeNull();
  });
});
