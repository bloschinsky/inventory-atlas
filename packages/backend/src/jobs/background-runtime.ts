import type { Kysely } from 'kysely';
import type { JobType } from './job-policy.js';
import { JobRepository } from './job-repository.js';
import { JobRunner, type JobHandler, type JobLogger } from './job-runner.js';
import { OutboxDispatcher, type OutboxRoute } from './outbox-dispatcher.js';

/** What the background runtime needs from the Media module, and nothing more. */
export interface MediaBackgroundPorts {
  processJob(
    payload: Record<string, unknown>,
    heartbeat: () => Promise<unknown>,
  ): Promise<Record<string, unknown>>;
  expireSessions(): Promise<string[]>;
  collectOrphans(limit?: number): Promise<{ deleted: string[]; retained: string[] }>;
}

export interface BackgroundRuntimeOptions {
  /** `compact` claims inside the API, `worker` in its own container, `disabled` never claims. */
  mode: 'compact' | 'worker' | 'disabled';
  /** Which process is asking; it decides whether this one claims under the configured mode. */
  host: 'api' | 'worker';
  workerId?: string;
  pollIntervalMs?: number;
  /** Media decoding concurrency; the runner still caps it at the approved ceiling. */
  mediaConcurrency?: number;
  cleanupIntervalMs?: number;
  routes?: readonly OutboxRoute[];
  logger?: JobLogger;
}

export interface BackgroundRuntime {
  readonly enabled: boolean;
  readonly runner: JobRunner<unknown> | null;
  start(): void;
  stop(): Promise<void>;
}

const defaultCleanupIntervalMs = 15 * 60_000;

/**
 * Assembles the queue, the outbox dispatcher and the media handlers into one runtime that both
 * deployment profiles start identically (blueprint section 12.2). Compact mode runs it inside
 * the API process and the expanded profile runs the same classes in the worker container, so a
 * behaviour difference between the two cannot arise from separate wiring.
 */
export function createBackgroundRuntime<Database>(
  database: Kysely<Database>,
  media: MediaBackgroundPorts,
  options: BackgroundRuntimeOptions,
): BackgroundRuntime {
  const repository = new JobRepository(database);
  const dispatcher = new OutboxDispatcher(database, repository, options.routes);
  const handlers = new Map<JobType, JobHandler>([
    [
      'media.process-v1',
      (payload, context) => media.processJob(payload, () => context.heartbeat()),
    ] as const,
    [
      'media.cleanup-v1',
      async () => {
        const sessions = await media.expireSessions();
        const orphans = await media.collectOrphans();
        return {
          expiredSessions: sessions.length,
          deletedAssets: orphans.deleted.length,
          retainedAssets: orphans.retained.length,
        };
      },
    ] as const,
  ]);
  // Compact mode claims in the API and the expanded profile claims only in the worker
  // container, so a deployment can never run two claim loops against one queue by accident.
  const claims = options.host === 'api' ? options.mode === 'compact' : options.mode === 'worker';
  if (!claims) return { enabled: false, runner: null, start: () => {}, stop: async () => {} };

  const runner = new JobRunner(repository, handlers, {
    ...(options.workerId ? { workerId: options.workerId } : {}),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.mediaConcurrency === undefined
      ? {}
      : { concurrency: { 'media.process-v1': options.mediaConcurrency } }),
    dispatcher: dispatcher as unknown as Pick<OutboxDispatcher<unknown>, 'dispatchDue'>,
    schedules: [
      { type: 'media.cleanup-v1', everyMs: options.cleanupIntervalMs ?? defaultCleanupIntervalMs },
    ],
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return {
    enabled: true,
    runner: runner as unknown as JobRunner<unknown>,
    start: () => runner.start(),
    stop: () => runner.stop(),
  };
}
