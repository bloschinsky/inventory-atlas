import { describe, expect, it } from 'vitest';
import { JobPermanentError, jobPolicy, type JobType } from './job-policy.js';
import type { JobRecord, JobRepository } from './job-repository.js';
import { JobRunner, type JobHandler } from './job-runner.js';

interface Recorded {
  failures: { id: string; code: string; permanent: boolean }[];
  completions: { id: string; progress: Record<string, unknown> }[];
  heartbeats: number;
  enqueued: string[];
}

/**
 * An in-memory queue. The point of these tests is the runner's behaviour around a handler, not
 * SQL, so the repository is replaced and the claim/lease semantics are covered by the
 * integration suite against real PostgreSQL.
 */
function fakeRepository(queue: JobRecord[]): {
  repository: JobRepository<unknown>;
  recorded: Recorded;
} {
  const recorded: Recorded = { failures: [], completions: [], heartbeats: 0, enqueued: [] };
  const repository = {
    claim: async (_workerId: string, demand: ReadonlyMap<JobType, number>) => {
      const taken: JobRecord[] = [];
      for (const [type, limit] of demand) {
        while (taken.filter((job) => job.type === type).length < limit) {
          const index = queue.findIndex((job) => job.type === type);
          if (index < 0) break;
          taken.push(queue.splice(index, 1)[0]!);
        }
      }
      return taken;
    },
    heartbeat: async () => {
      recorded.heartbeats += 1;
      return true;
    },
    complete: async (id: string, _worker: string, progress: Record<string, unknown> = {}) => {
      recorded.completions.push({ id, progress });
      return true;
    },
    fail: async (
      id: string,
      _worker: string,
      failure: { code: string; message: unknown; permanent: boolean },
    ) => {
      recorded.failures.push({ id, code: failure.code, permanent: failure.permanent });
      return failure.permanent ? 'dead' : 'retry_wait';
    },
    reclaimExpiredLeases: async () => [],
    enqueue: async (input: { idempotencyKey: string }) => {
      recorded.enqueued.push(input.idempotencyKey);
      return { id: 'scheduled', created: true };
    },
  } as unknown as JobRepository<unknown>;
  return { repository, recorded };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    type: 'media.process-v1',
    payload: { assetId: 'asset-1' },
    payloadVersion: 1,
    state: 'running',
    attempt: 1,
    maxAttempts: 4,
    availableAt: new Date(0),
    leasedUntil: new Date(60_000),
    workerId: 'runner',
    idempotencyKey: 'media.process-v1:asset-1',
    lastErrorCode: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

async function drain(runner: JobRunner<unknown>): Promise<void> {
  await runner.runOnce();
  await runner.stop();
}

describe('job runner', () => {
  it('completes a handler and stores its bounded progress', async () => {
    const { repository, recorded } = fakeRepository([job()]);
    const handler: JobHandler = async () => ({ assetId: 'asset-1', variants: 'thumb' });
    await drain(new JobRunner(repository, new Map([['media.process-v1', handler]])));
    expect(recorded.completions).toEqual([
      { id: 'job-1', progress: { assetId: 'asset-1', variants: 'thumb' } },
    ]);
    expect(recorded.failures).toHaveLength(0);
  });

  it('turns a child crash into a retry instead of terminating the process', async () => {
    const { repository, recorded } = fakeRepository([job()]);
    const handler: JobHandler = async () => {
      const crash = new Error('The image processing child was terminated by SIGKILL.');
      (crash as Error & { code: string }).code = 'MEDIA_PROCESSING_CHILD_CRASHED';
      throw crash;
    };
    await drain(new JobRunner(repository, new Map([['media.process-v1', handler]])));
    expect(recorded.failures).toEqual([
      { id: 'job-1', code: 'MEDIA_PROCESSING_CHILD_CRASHED', permanent: false },
    ]);
  });

  it('sends a permanent decoding failure straight to dead state', async () => {
    const { repository, recorded } = fakeRepository([job()]);
    const handler: JobHandler = async () => {
      throw new JobPermanentError('MEDIA_DECODE_UNSUPPORTED', 'not a decodable image');
    };
    await drain(new JobRunner(repository, new Map([['media.process-v1', handler]])));
    expect(recorded.failures).toEqual([
      { id: 'job-1', code: 'MEDIA_DECODE_UNSUPPORTED', permanent: true },
    ]);
  });

  it('classifies a handler that threw a non-Error without crashing the loop', async () => {
    const { repository, recorded } = fakeRepository([job()]);
    const handler: JobHandler = async () => {
      throw 'decoder exploded';
    };
    await drain(new JobRunner(repository, new Map([['media.process-v1', handler]])));
    expect(recorded.failures[0]).toMatchObject({ code: 'JOB_HANDLER_FAILED', permanent: false });
  });

  it('never claims more media work than the approved concurrency ceiling', async () => {
    const queue = Array.from({ length: 6 }, (_, index) => job({ id: `job-${index}` }));
    const { repository, recorded } = fakeRepository(queue);
    let peak = 0;
    let active = 0;
    const handler: JobHandler = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    const runner = new JobRunner(repository, new Map([['media.process-v1', handler]]), {
      concurrency: { 'media.process-v1': 99 },
    });
    expect(runner.concurrencyFor('media.process-v1')).toBe(2);
    await runner.runOnce();
    await runner.stop();
    expect(peak).toBeLessThanOrEqual(2);
    expect(recorded.completions.length).toBeLessThanOrEqual(2);
  });

  it('defaults each type to its declared concurrency', () => {
    const runner = new JobRunner(fakeRepository([]).repository, new Map());
    expect(runner.concurrencyFor('media.process-v1')).toBe(
      jobPolicy('media.process-v1').concurrency,
    );
  });

  it('keeps recurring maintenance queued under one key per interval', async () => {
    const { repository, recorded } = fakeRepository([]);
    const runner = new JobRunner(repository, new Map([['media.cleanup-v1', async () => {}]]), {
      schedules: [{ type: 'media.cleanup-v1', everyMs: 60_000 }],
    });
    await runner.runOnce();
    await runner.runOnce();
    await runner.stop();
    expect(new Set(recorded.enqueued).size).toBe(1);
    expect(recorded.enqueued[0]).toMatch(/^media\.cleanup-v1:tick:\d+$/u);
  });

  it('survives a dispatcher that fails and still claims work', async () => {
    const { repository, recorded } = fakeRepository([job()]);
    const runner = new JobRunner(repository, new Map([['media.process-v1', async () => {}]]), {
      dispatcher: {
        dispatchDue: async () => {
          throw new Error('outbox unavailable');
        },
      },
    });
    await drain(runner);
    expect(recorded.completions).toHaveLength(1);
  });
});
