import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor, type SessionActor } from '../auth/index.js';
import { migrateToLatest } from '../database.js';
import { createDatabase } from '../database.js';
import {
  TransactionalAuditPort,
  TransactionalMovementHistoryPort,
  TransactionalOutboxPort,
  TransactionalSearchProjectionPort,
} from '../infrastructure/index.js';
import { createSettingsClient } from '../settings.repository.js';
import { TransactionalAttributeValuePort } from '../schema/attribute-value-port.js';
import { FieldDefinitionRepository } from '../schema/field-definition-repository.js';
import { fileURLToPath } from 'node:url';
import { StorageRepository, type StorageDatabase } from './storage-repository.js';
import { StorageService } from './storage-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `storage_${randomUUID().replaceAll('-', '')}`;
const now = new Date('2026-09-12T10:00:00.000Z');

let adminPool: Pool;
let pool: Pool;
let database: Kysely<StorageDatabase>;
let prisma: ReturnType<typeof createSettingsClient>;
let service: StorageService;
let repository: StorageRepository;
let editor: SessionActor;
let owner: SessionActor;
let requiredFieldId: string;
let categoryId: string;
let lifecycleStatusId: string;

suite('STO-01/STO-02 Storage tree', () => {
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
    pool = new Pool({ connectionString: schemaUrl, max: 3 });
    database = createDatabase(schemaUrl, 4) as unknown as Kysely<StorageDatabase>;
    prisma = createSettingsClient(schemaUrl, 4);
    const editorId = randomUUID();
    const ownerId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: editorId,
          emailNormalized: 'storage-editor@example.test',
          displayName: 'Storage Editor',
          passwordHash: '$argon2id$synthetic',
          role: 'editor',
        },
        {
          id: ownerId,
          emailNormalized: 'storage-owner@example.test',
          displayName: 'Storage Owner',
          passwordHash: '$argon2id$synthetic',
          role: 'owner',
        },
      ],
    });
    editor = actorFor(editorId, 'editor');
    owner = actorFor(ownerId, 'owner');
    requiredFieldId = randomUUID();
    await prisma.fieldDefinition.create({
      data: {
        id: requiredFieldId,
        key: 'climate_note',
        scope: 'storage_node',
        labelI18n: { en: 'Climate note', uk: 'Нотатка про клімат' },
        dataType: 'text',
        required: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    categoryId = randomUUID();
    lifecycleStatusId = randomUUID();
    await prisma.category.create({
      data: {
        id: categoryId,
        key: 'stored_things',
        labelI18n: { en: 'Stored things' },
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.lifecycleStatus.create({
      data: {
        id: lifecycleStatusId,
        key: 'stored',
        labelI18n: { en: 'Stored' },
        colorToken: 'status.info',
        createdAt: now,
        updatedAt: now,
      },
    });
    repository = new StorageRepository(database, randomUUID, () => now);
    service = new StorageService(
      repository,
      new FieldDefinitionRepository(prisma),
      {
        attributes: new TransactionalAttributeValuePort(),
        audit: new TransactionalAuditPort(),
        movements: new TransactionalMovementHistoryPort(),
        outbox: new TransactionalOutboxPort(),
        search: new TransactionalSearchProjectionPort(),
      },
      () => now,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.destroy();
    await pool?.end();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('creates and browses an indexed nine-node chain with stable UUID-hex labels', async () => {
    let parentPublicId: string | null = null;
    const chain = [];
    for (let depth = 0; depth <= 8; depth += 1) {
      const created = await service.create(editor, {
        parentPublicId,
        nodeType: depth === 0 ? 'site' : 'container',
        title: `Level ${depth}`,
        attributes: { climate_note: `Synthetic ${depth}` },
      });
      chain.push(created);
      parentPublicId = created.publicId;
    }
    expect(chain.at(-1)).toMatchObject({ depth: 8, title: 'Level 8' });
    const stored = await repository.subtree(chain[0]!.publicId);
    expect(stored).toHaveLength(9);
    expect(
      stored.every((entry) => entry.path.split('.').at(-1) === `n${entry.id.replaceAll('-', '')}`),
    ).toBe(true);
    const detail = await service.get(editor, chain.at(-1)!.publicId);
    expect(detail.breadcrumb.map((entry) => entry.title)).toEqual(
      Array.from({ length: 9 }, (_entry, index) => `Level ${index}`),
    );

    await pool.query('set enable_seqscan = off');
    const breadcrumbPlan = JSON.stringify(
      (
        await pool.query(
          'explain (format json) select * from storage_nodes where path @> $1::ltree',
          [stored.at(-1)!.path],
        )
      ).rows[0],
    );
    const childrenPlan = JSON.stringify(
      (
        await pool.query('explain (format json) select * from storage_nodes where parent_id = $1', [
          stored[0]!.id,
        ])
      ).rows[0],
    );
    expect(breadcrumbPlan).toContain('storage_nodes_path_gist_idx');
    expect(childrenPlan).toContain('storage_nodes_parent_idx');
  });

  it('rolls back node, attributes, version, projection, audit and outbox when replacement omits a required attribute', async () => {
    const node = await service.create(editor, {
      nodeType: 'site',
      title: 'Stable warehouse',
      attributes: { climate_note: 'Dry' },
    });
    const storedNode = await repository.findByPublicId(node.publicId);
    const itemId = randomUUID();
    await prisma.item.create({
      data: {
        id: itemId,
        publicId: randomUUID(),
        slug: 'rollback-item',
        categoryId,
        lifecycleStatusId,
        storageNodeId: storedNode!.id,
        displayName: 'Rollback item',
        createdAt: now,
        updatedAt: now,
      },
    });
    await pool.query(
      `insert into item_search (
        item_id, display_name, category_id, lifecycle_status_id, path_text, search_vector,
        public_search_vector, visibility, item_updated_at, indexed_at
      ) values ($1, 'Rollback item', $2, $3, 'Stable warehouse',
        to_tsvector('simple', 'Rollback item'), to_tsvector('simple', ''),
        'authenticated', $4, $4)`,
      [itemId, categoryId, lifecycleStatusId, now],
    );
    const countsBefore = await counts();
    await expect(
      service.update(editor, node.publicId, node.version, {
        title: 'Changed warehouse',
        attributes: {},
      }),
    ).rejects.toMatchObject({ issues: [{ fieldKey: 'climate_note', code: 'REQUIRED' }] });
    expect(await counts()).toEqual(countsBefore);
    expect(await repository.findByPublicId(node.publicId)).toMatchObject({
      title: 'Stable warehouse',
      version: node.version,
    });
    expect(
      (
        await pool.query(
          `select value_text from attribute_values
           where storage_node_id = $1 and field_definition_id = $2`,
          [storedNode!.id, requiredFieldId],
        )
      ).rows,
    ).toEqual([{ value_text: 'Dry' }]);
    expect(
      (await pool.query('select path_text from item_search where item_id = $1', [itemId])).rows[0],
    ).toEqual({ path_text: 'Stable warehouse' });
  });

  it('renames without changing path and synchronously refreshes nested Item breadcrumbs', async () => {
    const root = await service.create(editor, {
      nodeType: 'site',
      title: 'Old warehouse',
      attributes: { climate_note: 'Dry' },
    });
    const child = await service.create(editor, {
      parentPublicId: root.publicId,
      nodeType: 'container',
      title: 'Box',
      attributes: { climate_note: 'Stable' },
    });
    const rootBefore = await repository.findByPublicId(root.publicId);
    const childRow = await repository.findByPublicId(child.publicId);
    const itemId = randomUUID();
    await prisma.item.create({
      data: {
        id: itemId,
        publicId: randomUUID(),
        slug: 'nested-item',
        categoryId,
        lifecycleStatusId,
        storageNodeId: childRow!.id,
        displayName: 'Nested item',
        createdAt: now,
        updatedAt: now,
      },
    });
    await pool.query(
      `insert into item_search (
        item_id, display_name, category_id, lifecycle_status_id, search_vector,
        public_search_vector, visibility, item_updated_at, indexed_at
      ) values ($1, 'Nested item', $2, $3, to_tsvector('simple', 'Nested item'),
        to_tsvector('simple', ''), 'authenticated', $4, $4)`,
      [itemId, categoryId, lifecycleStatusId, now],
    );

    const renamed = await service.update(editor, root.publicId, root.version, {
      title: 'New warehouse',
    });
    expect(renamed.version).toBe(2);
    expect((await repository.findByPublicId(root.publicId))!.path).toBe(rootBefore!.path);
    expect(
      (await pool.query('select path_text from item_search where item_id = $1', [itemId])).rows[0],
    ).toEqual({ path_text: 'New warehouse / Box' });

    await service.update(editor, root.publicId, renamed.version, { archived: true });
    expect(
      (await pool.query('select visibility from item_search where item_id = $1', [itemId])).rows[0],
    ).toEqual({ visibility: 'unlisted' });
  });

  it('keeps private and unlisted nodes out of browse results while allowing permitted direct access', async () => {
    const privateNode = await service.create(owner, {
      nodeType: 'site',
      title: 'Private store',
      visibility: 'private',
      attributes: { climate_note: 'Secret' },
    });
    const privateChild = await service.create(owner, {
      parentPublicId: privateNode.publicId,
      nodeType: 'container',
      title: 'Private shelf',
      attributes: { climate_note: 'Secret child' },
    });
    const unlistedNode = await service.create(editor, {
      nodeType: 'site',
      title: 'Unlisted store',
      visibility: 'unlisted',
      attributes: { climate_note: 'Direct only' },
    });
    const editorRoots = await service.list(editor, {});
    expect(editorRoots.entries.map((entry) => entry.publicId)).not.toContain(privateNode.publicId);
    expect(editorRoots.entries.map((entry) => entry.publicId)).not.toContain(unlistedNode.publicId);
    await expect(service.get(editor, privateNode.publicId)).rejects.toMatchObject({
      code: 'STORAGE_NOT_FOUND',
    });
    await expect(service.get(editor, privateChild.publicId)).rejects.toMatchObject({
      code: 'STORAGE_NOT_FOUND',
    });
    await expect(
      service.create(editor, {
        parentPublicId: privateNode.publicId,
        nodeType: 'container',
        title: 'Guessed child',
        attributes: { climate_note: 'Should roll back' },
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_PARENT_NOT_FOUND' });
    await expect(
      service.update(editor, privateChild.publicId, privateChild.version, {
        title: 'Guessed edit',
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_FOUND' });
    await expect(
      service.list(editor, { parentPublicId: privateNode.publicId }),
    ).rejects.toMatchObject({
      code: 'STORAGE_PARENT_NOT_FOUND',
    });
    expect((await service.get(owner, privateNode.publicId)).title).toBe('Private store');
    expect(
      (await service.list(owner, { parentPublicId: privateNode.publicId })).entries,
    ).toContainEqual(expect.objectContaining({ publicId: privateChild.publicId }));
    expect((await service.get(editor, unlistedNode.publicId)).title).toBe('Unlisted store');
  });

  it('paginates mixed direct child-node and Item contents without duplicates', async () => {
    const parent = await service.create(editor, {
      nodeType: 'site',
      title: 'Paged store',
      attributes: { climate_note: 'Dry' },
    });
    const parentRow = await repository.findByPublicId(parent.publicId);
    for (const title of ['Child A', 'Child B', 'Child C'])
      await service.create(editor, {
        parentPublicId: parent.publicId,
        nodeType: 'container',
        title,
        attributes: { climate_note: 'Dry' },
      });
    for (const title of ['Item A', 'Item B'])
      await prisma.item.create({
        data: {
          id: randomUUID(),
          publicId: randomUUID(),
          slug: title.toLowerCase().replace(' ', '-'),
          categoryId,
          lifecycleStatusId,
          storageNodeId: parentRow!.id,
          displayName: title,
          createdAt: now,
          updatedAt: now,
        },
      });
    const first = await service.get(editor, parent.publicId, { limit: 2 });
    const second = await service.get(editor, parent.publicId, {
      limit: 2,
      cursor: first.contents.nextCursor,
    });
    const third = await service.get(editor, parent.publicId, {
      limit: 2,
      cursor: second.contents.nextCursor,
    });
    const ids = [
      ...first.contents.entries,
      ...second.contents.entries,
      ...third.contents.entries,
    ].map((entry) => entry.publicId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(third.contents.nextCursor).toBeNull();
  });

  it('moves a complete subtree across roots and commits history, projections, audit and outbox', async () => {
    const rootA = await createNode('Move source root');
    const source = await createNode('Move source', rootA.publicId);
    const descendant = await createNode('Move descendant', source.publicId);
    const rootB = await createNode('Move target root');
    const target = await createNode('Move target', rootB.publicId);
    const sourceBefore = await repository.findByPublicId(source.publicId);
    const descendantBefore = await repository.findByPublicId(descendant.publicId);
    const targetRow = await repository.findByPublicId(target.publicId);
    const rootBRow = await repository.findByPublicId(rootB.publicId);
    const itemId = await createProjectedItem(descendant.publicId, 'Moved item');
    const contexts: string[] = [];
    const movementPort = new TransactionalMovementHistoryPort();
    const searchPort = new TransactionalSearchProjectionPort();
    const auditPort = new TransactionalAuditPort();
    const outboxPort = new TransactionalOutboxPort();
    const moveService = new StorageService(
      repository,
      {
        async listDefinitions() {
          throw new Error('Move must not query the Prisma-owned schema repository.');
        },
      },
      {
        attributes: new TransactionalAttributeValuePort(),
        movements: {
          async append(context, movement) {
            contexts.push(`movement:${context.kind}`);
            await movementPort.append(context, movement);
          },
        },
        search: {
          async syncStorageSubtree(context, storageNodeId, indexedAt) {
            contexts.push(`projection:${context.kind}`);
            await searchPort.syncStorageSubtree(context, storageNodeId, indexedAt);
          },
        },
        audit: {
          async record(context, event) {
            contexts.push(`audit:${context.kind}`);
            await auditPort.record(context, event);
          },
        },
        outbox: {
          async enqueue(context, message) {
            contexts.push(`outbox:${context.kind}`);
            await outboxPort.enqueue(context, message);
          },
        },
      },
      () => now,
    );

    const moved = await moveService.move(
      editor,
      source.publicId,
      source.version,
      { targetParentPublicId: target.publicId, reason: 'Rebalance storage' },
      { correlationId: 'sto-02-cross-root' },
    );

    expect(moved).toMatchObject({
      parentPublicId: target.publicId,
      depth: target.depth + 1,
      version: source.version + 1,
    });
    expect(contexts).toEqual([
      'movement:kysely',
      'projection:kysely',
      'audit:kysely',
      'outbox:kysely',
    ]);
    const sourceAfter = await repository.findByPublicId(source.publicId);
    const descendantAfter = await repository.findByPublicId(descendant.publicId);
    expect(sourceAfter).toMatchObject({
      parentId: targetRow!.id,
      depth: targetRow!.depth + 1,
      treeRootId: rootBRow!.id,
      version: sourceBefore!.version + 1,
    });
    expect(descendantAfter).toMatchObject({
      depth: targetRow!.depth + 2,
      treeRootId: rootBRow!.id,
      version: descendantBefore!.version + 1,
    });
    expect(descendantAfter!.path.startsWith(`${sourceAfter!.path}.`)).toBe(true);
    expect(
      (
        await pool.query('select path_text, visibility from item_search where item_id = $1', [
          itemId,
        ])
      ).rows[0],
    ).toEqual({
      path_text: 'Move target root / Move target / Move source / Move descendant',
      visibility: 'authenticated',
    });
    expect(
      (
        await pool.query(
          `select storage_node_id::text, from_node_id::text, to_node_id::text,
             from_path_snapshot, to_path_snapshot, reason, correlation_id
           from movements where storage_node_id = $1`,
          [sourceAfter!.id],
        )
      ).rows,
    ).toEqual([
      {
        storage_node_id: sourceAfter!.id,
        from_node_id: sourceBefore!.parentId,
        to_node_id: targetRow!.id,
        from_path_snapshot: sourceBefore!.path,
        to_path_snapshot: sourceAfter!.path,
        reason: 'Rebalance storage',
        correlation_id: 'sto-02-cross-root',
      },
    ]);
    expect(
      (
        await pool.query(
          "select count(*)::int as count from audit_events where action = 'storage_node.moved'",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select payload_json from outbox where topic = 'search.rebuild-items.v1' and aggregate_id = $1",
          [sourceAfter!.id],
        )
      ).rows[0].payload_json,
    ).toMatchObject({ event: 'NodeMoved', subtreeRootId: sourceAfter!.id });
  });

  it('rejects own-descendant and unavailable targets without partial updates', async () => {
    const root = await createNode('Cycle root');
    const source = await createNode('Cycle source', root.publicId);
    const descendant = await createNode('Cycle descendant', source.publicId);
    const archivedTarget = await createNode('Archived move target');
    await service.update(editor, archivedTarget.publicId, archivedTarget.version, {
      archived: true,
    });
    const before = await repository.subtree(source.publicId);
    const countsBefore = await movementEffectCounts();

    await expect(
      service.move(editor, source.publicId, source.version, {
        targetParentPublicId: descendant.publicId,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_MOVE_CYCLE' });
    await expect(
      service.move(editor, source.publicId, source.version, {
        targetParentPublicId: archivedTarget.publicId,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_FOUND' });
    await expect(
      service.move(editor, source.publicId, source.version, {
        targetParentPublicId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_FOUND' });

    expect(await repository.subtree(source.publicId)).toEqual(before);
    expect(await movementEffectCounts()).toEqual(countsBefore);
  });

  it('rolls back the subtree and every side effect when a supplied Kysely port fails', async () => {
    const sourceRoot = await createNode('Rollback source root');
    const source = await createNode('Rollback move source', sourceRoot.publicId);
    const descendant = await createNode('Rollback move descendant', source.publicId);
    const target = await createNode('Rollback move target');
    const itemId = await createProjectedItem(descendant.publicId, 'Rollback moved item');
    const before = await repository.subtree(source.publicId);
    const projectionBefore = (
      await pool.query('select path_text, visibility from item_search where item_id = $1', [itemId])
    ).rows[0];
    const countsBefore = await movementEffectCounts();
    const outbox = new TransactionalOutboxPort();
    const failingService = new StorageService(
      repository,
      new FieldDefinitionRepository(prisma),
      {
        attributes: new TransactionalAttributeValuePort(),
        audit: new TransactionalAuditPort(),
        movements: new TransactionalMovementHistoryPort(),
        search: new TransactionalSearchProjectionPort(),
        outbox: {
          async enqueue(context, message) {
            await outbox.enqueue(context, message);
            throw new Error('synthetic outbox failure');
          },
        },
      },
      () => now,
    );

    await expect(
      failingService.move(editor, source.publicId, source.version, {
        targetParentPublicId: target.publicId,
      }),
    ).rejects.toThrow('synthetic outbox failure');
    expect(await repository.subtree(source.publicId)).toEqual(before);
    expect(
      (
        await pool.query('select path_text, visibility from item_search where item_id = $1', [
          itemId,
        ])
      ).rows[0],
    ).toEqual(projectionBefore);
    expect(await movementEffectCounts()).toEqual(countsBefore);
  });

  it('serializes opposing moves and a concurrent rename while retaining a valid tree projection', async () => {
    const rootA = await createNode('Concurrent root A');
    const childA = await createNode('Concurrent child A', rootA.publicId);
    const rootB = await createNode('Concurrent root B');
    const childB = await createNode('Concurrent child B', rootB.publicId);

    await Promise.all([
      service.move(editor, childA.publicId, childA.version, {
        targetParentPublicId: rootB.publicId,
      }),
      service.move(editor, childB.publicId, childB.version, {
        targetParentPublicId: rootA.publicId,
      }),
    ]);
    const allNodes = [
      ...(await repository.subtree(rootA.publicId)),
      ...(await repository.subtree(rootB.publicId)),
    ];
    expect(new Set(allNodes.map((node) => node.id)).size).toBe(4);
    expect(allNodes.every((node) => node.depth === node.path.split('.').length - 1)).toBe(true);
    expect((await repository.findByPublicId(childA.publicId))!.treeRootId).toBe(
      (await repository.findByPublicId(rootB.publicId))!.id,
    );
    expect((await repository.findByPublicId(childB.publicId))!.treeRootId).toBe(
      (await repository.findByPublicId(rootA.publicId))!.id,
    );

    const renameTarget = await createNode('Old concurrent target');
    const renameSourceRoot = await createNode('Rename source root');
    const renameSource = await createNode('Rename move source', renameSourceRoot.publicId);
    const itemId = await createProjectedItem(renameSource.publicId, 'Concurrent moved item');
    await Promise.all([
      service.update(editor, renameTarget.publicId, renameTarget.version, {
        title: 'New concurrent target',
      }),
      service.move(editor, renameSource.publicId, renameSource.version, {
        targetParentPublicId: renameTarget.publicId,
      }),
    ]);
    expect(
      (await pool.query('select path_text from item_search where item_id = $1', [itemId])).rows[0],
    ).toEqual({ path_text: 'New concurrent target / Rename move source' });
  });
});

function actorFor(id: string, role: 'editor' | 'owner'): SessionActor {
  return {
    id,
    email: `${role}@example.test`,
    displayName: role,
    locale: 'en',
    role,
    permissions: permissionsFor(role),
  };
}

async function counts() {
  const tables = ['storage_nodes', 'attribute_values', 'audit_events', 'outbox'];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        Number((await pool.query(`select count(*)::int as count from ${table}`)).rows[0].count),
      ]),
    ),
  );
}

async function createNode(title: string, parentPublicId?: string) {
  return service.create(editor, {
    ...(parentPublicId ? { parentPublicId } : {}),
    nodeType: parentPublicId ? 'container' : 'site',
    title,
    attributes: { climate_note: 'Synthetic' },
  });
}

async function createProjectedItem(storagePublicId: string, displayName: string): Promise<string> {
  const storage = await repository.findByPublicId(storagePublicId);
  const itemId = randomUUID();
  await prisma.item.create({
    data: {
      id: itemId,
      publicId: randomUUID(),
      slug: displayName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-'),
      categoryId,
      lifecycleStatusId,
      storageNodeId: storage!.id,
      displayName,
      createdAt: now,
      updatedAt: now,
    },
  });
  await pool.query(
    `insert into item_search (
      item_id, display_name, category_id, lifecycle_status_id, search_vector,
      public_search_vector, visibility, item_updated_at, indexed_at
    ) values ($1, $2, $3, $4, to_tsvector('simple', $2),
      to_tsvector('simple', ''), 'authenticated', $5, $5)`,
    [itemId, displayName, categoryId, lifecycleStatusId, now],
  );
  return itemId;
}

async function movementEffectCounts() {
  const tables = ['movements', 'audit_events', 'outbox'];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        Number((await pool.query(`select count(*)::int as count from ${table}`)).rows[0].count),
      ]),
    ),
  );
}
