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
import { ItemRepository } from './item-repository.js';
import { ItemService } from './item-service.js';

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
    () => instant,
  );
}
