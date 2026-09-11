import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  backoffDelayMs,
  jobPolicy,
  nextFailureState,
  normalizeProgress,
  truncateErrorMessage,
  type JobState,
  type JobType,
} from './job-policy.js';

export interface JobRecord {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  payloadVersion: number;
  state: JobState;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leasedUntil: Date | null;
  workerId: string | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  createdAt: Date;
}

interface JobRow {
  id: string;
  type: string;
  payload_json: unknown;
  payload_version: number;
  state: string;
  attempt: number;
  max_attempts: number;
  available_at: Date;
  leased_until: Date | null;
  worker_id: string | null;
  idempotency_key: string;
  last_error_code: string | null;
  created_at: Date;
}

export interface EnqueueJobInput {
  type: JobType;
  payload: Record<string, unknown>;
  /** Repeating the same key never creates a second job; it only wakes the waiting one. */
  idempotencyKey: string;
  payloadVersion?: number;
  availableAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

// Qualified because the claim statement returns from `update jobs ... from due`, where a bare
// column name would be ambiguous.
const selection = sql`
  jobs.id, jobs.type, jobs.payload_json, jobs.payload_version, jobs.state, jobs.attempt,
  jobs.max_attempts, jobs.available_at, jobs.leased_until, jobs.worker_id,
  jobs.idempotency_key, jobs.last_error_code, jobs.created_at
`;

/**
 * The Kysely-only job store (blueprint sections 8.10 and 14.1). Claiming is a short transaction
 * using `for update skip locked`, so two runners never take the same row and a busy row never
 * blocks a peer. Work itself executes outside that transaction under a lease.
 */
export class JobRepository<Database> {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * Creates the job, or wakes an identical one that is still waiting. A job that is running right
   * now, or already reached a terminal state, is left exactly as it is.
   */
  async enqueue(
    input: EnqueueJobInput,
    executor: Kysely<Database> = this.database,
  ): Promise<{ id: string; created: boolean }> {
    const now = this.now();
    const policy = jobPolicy(input.type);
    const availableAt = input.availableAt ?? now;
    const { rows } = await sql<{ id: string; created: boolean }>`
      insert into jobs (
        id, type, payload_json, payload_version, state, priority, attempt, max_attempts,
        available_at, idempotency_key, progress_json, created_at, updated_at
      ) values (
        ${this.newId()}::uuid, ${input.type}, ${JSON.stringify(input.payload)}::jsonb,
        ${input.payloadVersion ?? 1}, 'queued', ${input.priority ?? policy.priority}, 0,
        ${input.maxAttempts ?? policy.maxAttempts}, ${availableAt}, ${input.idempotencyKey},
        '{}'::jsonb, ${now}, ${now}
      )
      on conflict (idempotency_key) do update set
        available_at = least(jobs.available_at, excluded.available_at),
        state = 'queued', worker_id = null, leased_until = null, heartbeat_at = null,
        updated_at = ${now}
        where jobs.state in ('queued', 'retry_wait')
      returning id, (xmax = 0) as created
    `.execute(executor);
    if (rows.length) return rows[0]!;
    // The key exists in a running or terminal state: the job was already created once.
    const existing = await sql<{ id: string }>`
      select id from jobs where idempotency_key = ${input.idempotencyKey}
    `.execute(executor);
    return { id: existing.rows[0]!.id, created: false };
  }

  /**
   * Takes due jobs for one worker, at most the requested number per type. The lease, worker ID,
   * heartbeat and attempt counter are set in the same short transaction as the row lock.
   */
  async claim(
    workerId: string,
    demand: ReadonlyMap<JobType, number>,
    now: Date = this.now(),
  ): Promise<JobRecord[]> {
    const claimed: JobRecord[] = [];
    for (const [type, limit] of demand) {
      if (limit <= 0) continue;
      const leasedUntil = new Date(now.getTime() + jobPolicy(type).leaseMs);
      const { rows } = await this.database.transaction().execute(async (transaction) =>
        sql<JobRow>`
          with due as (
            select id from jobs
              where type = ${type} and state in ('queued', 'retry_wait')
                and available_at <= ${now} and attempt < max_attempts
              order by priority asc, available_at asc, created_at asc
              limit ${limit}
              for update skip locked
          )
          update jobs set
            state = 'running', worker_id = ${workerId}, leased_until = ${leasedUntil},
            heartbeat_at = ${now}, attempt = jobs.attempt + 1, updated_at = ${now}
            from due where jobs.id = due.id
            returning ${selection}
        `.execute(transaction),
      );
      claimed.push(...rows.map(toJobRecord));
    }
    return claimed;
  }

  /**
   * Extends a live lease. A false result means the lease was lost and the work must stop. The
   * caller passes the type it claimed so a heartbeat costs one statement, not two.
   */
  async heartbeat(
    id: string,
    workerId: string,
    progress?: Record<string, unknown>,
    type?: JobType,
  ): Promise<boolean> {
    const now = this.now();
    const leasedUntil = new Date(
      now.getTime() + jobPolicy(type ?? (await this.typeOf(id))).leaseMs,
    );
    const { rows } = await sql<{ id: string }>`
      update jobs set
        heartbeat_at = ${now}, leased_until = ${leasedUntil}, updated_at = ${now},
        progress_json = ${JSON.stringify(normalizeProgress(progress ?? {}))}::jsonb
        where id = ${id}::uuid and worker_id = ${workerId} and state = 'running'
        returning id
    `.execute(this.database);
    return rows.length === 1;
  }

  async complete(
    id: string,
    workerId: string,
    progress: Record<string, unknown> = {},
  ): Promise<boolean> {
    const now = this.now();
    const { rows } = await sql<{ id: string }>`
      update jobs set
        state = 'succeeded', completed_at = ${now}, worker_id = null, leased_until = null,
        heartbeat_at = null, last_error_code = null, last_error_message = null,
        progress_json = ${JSON.stringify(normalizeProgress(progress))}::jsonb, updated_at = ${now}
        where id = ${id}::uuid and worker_id = ${workerId} and state = 'running'
        returning id
    `.execute(this.database);
    return rows.length === 1;
  }

  /**
   * Records a failed attempt. A permanent error and an exhausted attempt budget both go to dead
   * state; anything else waits out an exponential backoff with jitter.
   */
  async fail(
    id: string,
    workerId: string,
    failure: { code: string; message: unknown; permanent: boolean },
  ): Promise<JobState | null> {
    const now = this.now();
    const job = await this.find(id);
    if (!job) return null;
    const policy = jobPolicy(job.type);
    const state = nextFailureState(job.attempt, policy, failure.permanent);
    const availableAt =
      state === 'retry_wait'
        ? new Date(now.getTime() + backoffDelayMs(job.attempt, policy, this.random))
        : job.availableAt;
    const { rows } = await sql<{ id: string }>`
      update jobs set
        state = ${state}, worker_id = null, leased_until = null, heartbeat_at = null,
        available_at = ${availableAt}, completed_at = ${state === 'dead' ? now : null},
        last_error_code = ${failure.code.slice(0, 96)},
        last_error_message = ${truncateErrorMessage(failure.message)}, updated_at = ${now}
        where id = ${id}::uuid and worker_id = ${workerId} and state = 'running'
        returning id
    `.execute(this.database);
    return rows.length === 1 ? state : null;
  }

  /**
   * Returns jobs whose lease expired - a crashed or killed runner - to retry or dead state. This
   * is what stops a child-process crash from stranding work forever.
   */
  async reclaimExpiredLeases(now: Date = this.now()): Promise<JobRecord[]> {
    const { rows } = await sql<JobRow>`
      update jobs set
        state = case when attempt >= max_attempts then 'dead' else 'retry_wait' end,
        completed_at = case when attempt >= max_attempts then ${now}::timestamptz else null end,
        worker_id = null, leased_until = null, heartbeat_at = null, updated_at = ${now},
        last_error_code = coalesce(last_error_code, 'JOB_LEASE_EXPIRED'),
        last_error_message = coalesce(last_error_message, 'The worker lease expired.')
        where state = 'running' and leased_until < ${now}
        returning ${selection}
    `.execute(this.database);
    return rows.map(toJobRecord);
  }

  async find(id: string): Promise<JobRecord | null> {
    const { rows } = await sql<JobRow>`
      select ${selection} from jobs where id = ${id}::uuid
    `.execute(this.database);
    return rows.length ? toJobRecord(rows[0]!) : null;
  }

  async findByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const { rows } = await sql<JobRow>`
      select ${selection} from jobs where idempotency_key = ${key}
    `.execute(this.database);
    return rows.length ? toJobRecord(rows[0]!) : null;
  }

  /** The Admin failed-job view: dead jobs, newest first. */
  async listDead(limit = 50): Promise<JobRecord[]> {
    const { rows } = await sql<JobRow>`
      select ${selection} from jobs where state = 'dead'
        order by completed_at desc limit ${limit}
    `.execute(this.database);
    return rows.map(toJobRecord);
  }

  /** Admin recovery: a dead job returns to the queue with a fresh attempt budget. */
  async requeue(id: string): Promise<boolean> {
    const now = this.now();
    const { rows } = await sql<{ id: string }>`
      update jobs set
        state = 'queued', attempt = 0, available_at = ${now}, completed_at = null,
        last_error_code = null, last_error_message = null, updated_at = ${now}
        where id = ${id}::uuid and state = 'dead'
        returning id
    `.execute(this.database);
    return rows.length === 1;
  }

  async cancel(id: string): Promise<boolean> {
    const now = this.now();
    const { rows } = await sql<{ id: string }>`
      update jobs set state = 'cancelled', completed_at = ${now}, updated_at = ${now}
        where id = ${id}::uuid and state in ('queued', 'retry_wait')
        returning id
    `.execute(this.database);
    return rows.length === 1;
  }

  async countByState(type: JobType, state: JobState): Promise<number> {
    const { rows } = await sql<{ total: string }>`
      select count(*)::text as total from jobs where type = ${type} and state = ${state}
    `.execute(this.database);
    return Number(rows[0]?.total ?? 0);
  }

  private async typeOf(id: string): Promise<JobType> {
    const { rows } = await sql<{ type: string }>`
      select type from jobs where id = ${id}::uuid
    `.execute(this.database);
    return (rows[0]?.type ?? 'media.process-v1') as JobType;
  }
}

function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: (row.payload_json ?? {}) as Record<string, unknown>,
    payloadVersion: row.payload_version,
    state: row.state as JobState,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leasedUntil: row.leased_until,
    workerId: row.worker_id,
    idempotencyKey: row.idempotency_key,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
  };
}
