import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateToLatest, type FoundationDatabase } from '../database.js';
import { jobPolicy } from './job-policy.js';
import { JobRepository } from './job-repository.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `jobs_${randomUUID().replaceAll('-', '')}`;
const instant = new Date('2026-09-11T12:00:00.000Z');

let database: ReturnType<typeof createDatabase>;
let adminDatabase: ReturnType<typeof createDatabase>;
let repository: JobRepository<FoundationDatabase>;
let now = instant;

function at(offsetMs: number): Date {
  return new Date(instant.getTime() + offsetMs);
}

suite('MED-02 job queue', () => {
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
    // A fixed random source makes the backoff assertions exact instead of approximate.
    repository = new JobRepository(
      database,
      () => now,
      randomUUID,
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
    now = instant;
    await sql`delete from jobs`.execute(database);
  });

  it('creates a job once for one idempotency key', async () => {
    const first = await repository.enqueue({
      type: 'media.process-v1',
      payload: { assetId: 'a' },
      idempotencyKey: 'media.process-v1:a',
    });
    const second = await repository.enqueue({
      type: 'media.process-v1',
      payload: { assetId: 'a' },
      idempotencyKey: 'media.process-v1:a',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('wakes a waiting job instead of queueing a second one', async () => {
    const { id } = await repository.enqueue({
      type: 'media.process-v1',
      payload: {},
      idempotencyKey: 'wake',
      availableAt: at(600_000),
    });
    await repository.enqueue({
      type: 'media.process-v1',
      payload: {},
      idempotencyKey: 'wake',
      availableAt: instant,
    });
    const job = await repository.find(id);
    expect(job?.availableAt.getTime()).toBe(instant.getTime());
    expect(job?.state).toBe('queued');
  });

  it('claims with a lease and never hands the same job to two workers', async () => {
    await repository.enqueue({
      type: 'media.process-v1',
      payload: {},
      idempotencyKey: 'single',
    });
    const demand = new Map([['media.process-v1' as const, 5]]);
    const [first, second] = await Promise.all([
      repository.claim('worker-a', demand, now),
      repository.claim('worker-b', demand, now),
    ]);
    expect(first.length + second.length).toBe(1);
    const claimed = [...first, ...second][0]!;
    expect(claimed.attempt).toBe(1);
    expect(claimed.leasedUntil!.getTime()).toBe(
      now.getTime() + jobPolicy('media.process-v1').leaseMs,
    );
  });

  it('claims due work in priority then age order', async () => {
    await repository.enqueue({
      type: 'media.process-v1',
      payload: { order: 'second' },
      idempotencyKey: 'low',
      priority: 300,
    });
    now = at(1_000);
    await repository.enqueue({
      type: 'media.process-v1',
      payload: { order: 'first' },
      idempotencyKey: 'high',
      priority: 10,
    });
    const claimed = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 2]]),
      at(2_000),
    );
    expect(claimed.map((job) => job.payload.order)).toEqual(['first', 'second']);
  });

  it('does not claim work that is not due yet', async () => {
    await repository.enqueue({
      type: 'media.process-v1',
      payload: {},
      idempotencyKey: 'later',
      availableAt: at(60_000),
    });
    expect(
      await repository.claim('worker', new Map([['media.process-v1' as const, 5]]), now),
    ).toHaveLength(0);
  });

  it('extends a live lease and refuses a heartbeat from a foreign worker', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'beat' });
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    now = at(30_000);
    expect(await repository.heartbeat(job!.id, 'worker', { step: 'thumb' })).toBe(true);
    expect(await repository.heartbeat(job!.id, 'intruder')).toBe(false);
    const extended = await repository.find(job!.id);
    expect(extended!.leasedUntil!.getTime()).toBe(
      now.getTime() + jobPolicy('media.process-v1').leaseMs,
    );
  });

  it('waits out an exponential backoff before a retry becomes due', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'retry' });
    const policy = jobPolicy('media.process-v1');
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    expect(
      await repository.fail(job!.id, 'worker', {
        code: 'MEDIA_PROCESSING_CHILD_CRASHED',
        message: 'child died',
        permanent: false,
      }),
    ).toBe('retry_wait');
    const waiting = await repository.find(job!.id);
    expect(waiting!.availableAt.getTime()).toBe(now.getTime() + policy.backoffBaseMs / 2);
    expect(
      await repository.claim('worker', new Map([['media.process-v1' as const, 1]]), now),
    ).toHaveLength(0);
    const retried = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      at(policy.backoffBaseMs),
    );
    expect(retried[0]!.attempt).toBe(2);
  });

  it('goes dead once the attempt budget is exhausted', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'dead' });
    const policy = jobPolicy('media.process-v1');
    let last: string | null = null;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      now = at(attempt * policy.backoffMaxMs);
      const [job] = await repository.claim(
        'worker',
        new Map([['media.process-v1' as const, 1]]),
        now,
      );
      expect(job).toBeDefined();
      last = await repository.fail(job!.id, 'worker', {
        code: 'MEDIA_PROCESSING_CHILD_CRASHED',
        message: 'child died again',
        permanent: false,
      });
    }
    expect(last).toBe('dead');
    const [dead] = await repository.listDead();
    expect(dead).toMatchObject({ state: 'dead', attempt: policy.maxAttempts });
    expect(
      await repository.claim(
        'worker',
        new Map([['media.process-v1' as const, 1]]),
        at(864_000_000),
      ),
    ).toHaveLength(0);
  });

  it('sends a permanent failure straight to dead state on the first attempt', async () => {
    await repository.enqueue({
      type: 'media.process-v1',
      payload: {},
      idempotencyKey: 'permanent',
    });
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    expect(
      await repository.fail(job!.id, 'worker', {
        code: 'MEDIA_DECODE_UNSUPPORTED',
        message: 'not an image',
        permanent: true,
      }),
    ).toBe('dead');
    expect((await repository.find(job!.id))!.lastErrorCode).toBe('MEDIA_DECODE_UNSUPPORTED');
  });

  it('returns a job whose worker died to retry, and to dead once exhausted', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'orphan' });
    const policy = jobPolicy('media.process-v1');
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    const [reclaimed] = await repository.reclaimExpiredLeases(at(policy.leaseMs + 1_000));
    expect(reclaimed).toMatchObject({ id: job!.id, state: 'retry_wait' });
    expect((await repository.find(job!.id))!.lastErrorCode).toBe('JOB_LEASE_EXPIRED');

    await sql`update jobs set attempt = max_attempts - 1 where id = ${job!.id}::uuid`.execute(
      database,
    );
    const [again] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      at(policy.backoffMaxMs),
    );
    expect(again).toBeDefined();
    const [expired] = await repository.reclaimExpiredLeases(at(864_000_000));
    expect(expired!.state).toBe('dead');
  });

  it('records completion without leaving a lease behind', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'done' });
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    expect(await repository.complete(job!.id, 'worker', { variants: 'thumb' })).toBe(true);
    const finished = await repository.find(job!.id);
    expect(finished).toMatchObject({ state: 'succeeded', workerId: null, leasedUntil: null });
    expect(await repository.complete(job!.id, 'worker')).toBe(false);
  });

  it('lets an Admin requeue a dead job and cancel a waiting one', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'admin' });
    const [job] = await repository.claim(
      'worker',
      new Map([['media.process-v1' as const, 1]]),
      now,
    );
    await repository.fail(job!.id, 'worker', {
      code: 'MEDIA_DECODE_FAILED',
      message: 'bad image',
      permanent: true,
    });
    expect(await repository.requeue(job!.id)).toBe(true);
    expect(await repository.find(job!.id)).toMatchObject({ state: 'queued', attempt: 0 });
    expect(await repository.cancel(job!.id)).toBe(true);
    expect(await repository.find(job!.id)).toMatchObject({ state: 'cancelled' });
    expect(await repository.cancel(job!.id)).toBe(false);
  });

  it('counts work per type so a runner can respect its concurrency budget', async () => {
    await repository.enqueue({ type: 'media.process-v1', payload: {}, idempotencyKey: 'count-1' });
    await repository.enqueue({ type: 'media.cleanup-v1', payload: {}, idempotencyKey: 'count-2' });
    expect(await repository.countByState('media.process-v1', 'queued')).toBe(1);
    expect(await repository.countByState('media.cleanup-v1', 'queued')).toBe(1);
    expect(await repository.countByState('media.process-v1', 'running')).toBe(0);
  });
});
