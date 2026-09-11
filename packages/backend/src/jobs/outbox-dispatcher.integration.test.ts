import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest, type FoundationDatabase } from '../database.js';
import { JobRepository } from './job-repository.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `outbox_${randomUUID().replaceAll('-', '')}`;
const instant = new Date('2026-09-11T12:00:00.000Z');

let database: ReturnType<typeof createDatabase>;
let adminDatabase: ReturnType<typeof createDatabase>;
let dispatcher: OutboxDispatcher<FoundationDatabase>;
let repository: JobRepository<FoundationDatabase>;

async function enqueueMessage(topic: string, aggregateId: string, key: string): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into outbox (
      id, topic, aggregate_type, aggregate_id, payload_json, deduplication_key,
      created_at, available_at
    ) values (
      ${id}::uuid, ${topic}, 'media_asset', ${aggregateId}::uuid,
      ${JSON.stringify({ assetId: aggregateId, mimeType: 'image/jpeg' })}::jsonb, ${key},
      ${instant}, ${instant}
    )
  `.execute(database);
  return id;
}

async function publishedAt(id: string): Promise<Date | null> {
  const { rows } = await sql<{ published_at: Date | null }>`
    select published_at from outbox where id = ${id}::uuid
  `.execute(database);
  return rows[0]?.published_at ?? null;
}

suite('MED-02 outbox dispatch', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminDatabase = createDatabase(parsed.toString(), 1);
    await sql.raw(`create schema "${schema}"`).execute(adminDatabase);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    const schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    database = createDatabase(schemaUrl, 4);
    repository = new JobRepository(database, () => instant);
    dispatcher = new OutboxDispatcher(
      database,
      repository,
      undefined,
      () => instant,
      () => 0,
    );
  });

  afterAll(async () => {
    if (database) await database.destroy();
    if (adminDatabase) {
      await sql.raw(`drop schema "${schema}" cascade`).execute(adminDatabase);
      await adminDatabase.destroy();
    }
  });

  beforeEach(async () => {
    await sql`delete from jobs`.execute(database);
    await sql`delete from outbox`.execute(database);
  });

  it('creates the media processing job and marks the message published together', async () => {
    const assetId = randomUUID();
    const messageId = await enqueueMessage('media.process-asset.v1', assetId, `m:${assetId}`);
    expect(await dispatcher.dispatchDue()).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
    expect(await publishedAt(messageId)).not.toBeNull();
    const job = await repository.findByIdempotencyKey(`media.process-v1:${assetId}`);
    expect(job).toMatchObject({ type: 'media.process-v1', state: 'queued', payloadVersion: 1 });
    expect(job!.payload).toEqual({ assetId, mimeType: 'image/jpeg' });
  });

  it('never dispatches the same message twice', async () => {
    const assetId = randomUUID();
    await enqueueMessage('media.process-asset.v1', assetId, `m:${assetId}`);
    await dispatcher.dispatchDue();
    expect(await dispatcher.dispatchDue()).toEqual({ dispatched: 0, skipped: 0, failed: 0 });
    const { rows } = await sql<{ total: string }>`select count(*)::text as total from jobs`.execute(
      database,
    );
    expect(rows[0]!.total).toBe('1');
  });

  it('leaves a topic no stage routes yet untouched', async () => {
    const messageId = await enqueueMessage(
      'search.rebuild-items.v1',
      randomUUID(),
      `s:${randomUUID()}`,
    );
    expect(await dispatcher.dispatchDue()).toEqual({ dispatched: 0, skipped: 0, failed: 0 });
    expect(await publishedAt(messageId)).toBeNull();
    expect(dispatcher.routedTopics).toEqual(['media.process-asset.v1']);
  });

  it('does not create a second job when the asset already has one', async () => {
    const assetId = randomUUID();
    await repository.enqueue({
      type: 'media.process-v1',
      payload: { assetId },
      idempotencyKey: `media.process-v1:${assetId}`,
    });
    const messageId = await enqueueMessage('media.process-asset.v1', assetId, `m:${assetId}`);
    expect(await dispatcher.dispatchDue()).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
    expect(await publishedAt(messageId)).not.toBeNull();
    const { rows } = await sql<{ total: string }>`select count(*)::text as total from jobs`.execute(
      database,
    );
    expect(rows[0]!.total).toBe('1');
  });

  it('records a failed dispatch and retries it later instead of losing the message', async () => {
    const assetId = randomUUID();
    const messageId = await enqueueMessage('media.process-asset.v1', assetId, `m:${assetId}`);
    const failing = new OutboxDispatcher(
      database,
      {
        enqueue: async () => {
          throw new Error('queue unavailable');
        },
      } as unknown as JobRepository<FoundationDatabase>,
      undefined,
      () => instant,
      () => 0,
    );
    expect(await failing.dispatchDue()).toEqual({ dispatched: 0, skipped: 0, failed: 1 });
    expect(await publishedAt(messageId)).toBeNull();
    const { rows } = await sql<{ attempt: number; last_error_code: string; available_at: Date }>`
      select attempt, last_error_code, available_at from outbox where id = ${messageId}::uuid
    `.execute(database);
    expect(rows[0]).toMatchObject({ attempt: 1, last_error_code: 'OUTBOX_DISPATCH_FAILED' });
    expect(rows[0]!.available_at.getTime()).toBeGreaterThan(instant.getTime());
    // The healthy dispatcher still picks it up once the backoff has passed.
    await sql`update outbox set available_at = ${instant} where id = ${messageId}::uuid`.execute(
      database,
    );
    expect(await dispatcher.dispatchDue()).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
  });
});
