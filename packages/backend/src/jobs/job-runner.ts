import { randomUUID } from 'node:crypto';
import {
  JobPermanentError,
  jobPolicy,
  jobTypes,
  maximumMediaConcurrency,
  truncateErrorMessage,
  type JobType,
} from './job-policy.js';
import type { JobRecord, JobRepository } from './job-repository.js';
import type { OutboxDispatcher } from './outbox-dispatcher.js';

export interface JobContext {
  readonly jobId: string;
  readonly attempt: number;
  /** Extends the lease while long work runs; false means the lease was lost. */
  heartbeat(progress?: Record<string, unknown>): Promise<boolean>;
}

export interface JobHandler {
  (payload: Record<string, unknown>, context: JobContext): Promise<Record<string, unknown> | void>;
}

export interface JobLogger {
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
}

/** A recurring maintenance job the runner keeps queued without an external scheduler. */
export interface JobSchedule {
  type: JobType;
  everyMs: number;
  payload?: Record<string, unknown>;
}

export interface JobRunnerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  /** Extra concurrency for a type, bounded by the blueprint's per-type ceiling. */
  concurrency?: Partial<Record<JobType, number>>;
  dispatcher?: Pick<OutboxDispatcher<unknown>, 'dispatchDue'>;
  schedules?: readonly JobSchedule[];
  logger?: JobLogger;
}

const silentLogger: JobLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The claim loop (blueprint section 14.1). One runner instance serves both deployment profiles:
 * the API starts it in compact mode and the worker container starts the same class in expanded
 * mode. Work always executes outside the claim transaction, under a heartbeat-extended lease,
 * and a handler failure only ever changes the job row - never the process.
 */
export class JobRunner<Database> {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly logger: JobLogger;
  private readonly inFlight = new Map<JobType, number>();
  private readonly running = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private tick: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: JobRepository<Database>,
    private readonly handlers: ReadonlyMap<JobType, JobHandler>,
    private readonly options: JobRunnerOptions = {},
  ) {
    this.workerId = (options.workerId ?? `runner-${randomUUID()}`).slice(0, 128);
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.logger = options.logger ?? silentLogger;
  }

  get id(): string {
    return this.workerId;
  }

  /** Concurrency per type, capped by the approved ceiling for media decoding. */
  concurrencyFor(type: JobType): number {
    const requested = this.options.concurrency?.[type] ?? jobPolicy(type).concurrency;
    const ceiling = type === 'media.process-v1' ? maximumMediaConcurrency : 8;
    return Math.max(1, Math.min(requested, ceiling));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.logger.info('jobs: runner started', {
      workerId: this.workerId,
      types: [...this.handlers.keys()],
    });
    this.schedule(0);
  }

  /** Stops claiming and waits for work already in flight to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.tick;
    await Promise.allSettled([...this.running]);
    this.logger.info('jobs: runner stopped', { workerId: this.workerId });
  }

  /**
   * One pass: reclaim expired leases, keep recurring work queued, dispatch committed outbox
   * messages, then claim and execute what this runner still has capacity for.
   */
  async runOnce(): Promise<number> {
    await this.guard('reclaim', () => this.reclaim());
    await this.guard('schedule', () => this.enqueueSchedules());
    await this.guard('dispatch', async () => {
      await this.options.dispatcher?.dispatchDue();
    });
    const demand = new Map<JobType, number>();
    for (const type of jobTypes) {
      if (!this.handlers.has(type)) continue;
      const free = this.concurrencyFor(type) - (this.inFlight.get(type) ?? 0);
      if (free > 0) demand.set(type, free);
    }
    if (!demand.size) return 0;
    const claimed = await this.repository.claim(this.workerId, demand);
    for (const job of claimed) this.launch(job);
    return claimed.length;
  }

  private launch(job: JobRecord): void {
    this.inFlight.set(job.type, (this.inFlight.get(job.type) ?? 0) + 1);
    const execution = this.execute(job).finally(() => {
      this.inFlight.set(job.type, Math.max(0, (this.inFlight.get(job.type) ?? 1) - 1));
      this.running.delete(execution);
    });
    this.running.add(execution);
  }

  /**
   * Runs one handler. Every outcome - success, a permanent rejection, a transient failure, or a
   * handler that threw something that is not an Error - ends as a row update, so an image that
   * cannot be decoded can never terminate the process that claimed it.
   */
  private async execute(job: JobRecord): Promise<void> {
    const policy = jobPolicy(job.type);
    const handler = this.handlers.get(job.type)!;
    let alive = true;
    const beat = setInterval(() => {
      void this.repository
        .heartbeat(job.id, this.workerId, undefined, job.type)
        .then((held) => {
          if (!held) alive = false;
        })
        .catch(() => {});
    }, policy.heartbeatMs);
    // The heartbeat must never hold a shutting-down process open.
    beat.unref?.();
    try {
      const progress = await handler(job.payload, {
        jobId: job.id,
        attempt: job.attempt,
        heartbeat: async (detail) => {
          if (!alive) return false;
          alive = await this.repository.heartbeat(job.id, this.workerId, detail, job.type);
          return alive;
        },
      });
      await this.repository.complete(job.id, this.workerId, progress ?? {});
      this.logger.info('jobs: job succeeded', { jobId: job.id, type: job.type });
    } catch (error) {
      const permanent = error instanceof JobPermanentError;
      const code = permanent ? error.code : errorCode(error);
      const state = await this.repository
        .fail(job.id, this.workerId, { code, message: error, permanent })
        .catch(() => null);
      this.logger[state === 'dead' ? 'error' : 'warn']('jobs: job failed', {
        jobId: job.id,
        type: job.type,
        attempt: job.attempt,
        state,
        code,
        reason: truncateErrorMessage(error),
      });
    } finally {
      clearInterval(beat);
    }
  }

  private async reclaim(): Promise<void> {
    const reclaimed = await this.repository.reclaimExpiredLeases();
    for (const job of reclaimed)
      this.logger.warn('jobs: lease expired', {
        jobId: job.id,
        type: job.type,
        state: job.state,
        attempt: job.attempt,
      });
  }

  /**
   * Recurring work is keyed by its time bucket, so repeated passes inside one interval collapse
   * onto a single job instead of queueing a new one every poll.
   */
  private async enqueueSchedules(): Promise<void> {
    for (const schedule of this.options.schedules ?? []) {
      if (!this.handlers.has(schedule.type)) continue;
      const bucket = Math.floor(Date.now() / schedule.everyMs);
      await this.repository.enqueue({
        type: schedule.type,
        payload: schedule.payload ?? {},
        idempotencyKey: `${schedule.type}:tick:${bucket}`,
      });
    }
  }

  private async guard(step: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error('jobs: maintenance step failed', {
        step,
        reason: truncateErrorMessage(error),
      });
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.tick = this.runOnce()
        .catch((error: unknown) => {
          this.logger.error('jobs: claim loop failed', { reason: truncateErrorMessage(error) });
          return 0;
        })
        .then((claimed) => {
          this.schedule(claimed > 0 ? 0 : this.pollIntervalMs);
        });
    }, delayMs);
    this.timer.unref?.();
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.trim() ? code.slice(0, 96) : 'JOB_HANDLER_FAILED';
}
