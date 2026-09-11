import { sql, type Kysely } from 'kysely';
import { backoffDelayMs, jobPolicy, truncateErrorMessage, type JobType } from './job-policy.js';
import type { JobRepository } from './job-repository.js';

export interface OutboxMessageRow {
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  deduplicationKey: string;
  attempt: number;
}

/**
 * How one outbox topic becomes background work. A topic without a route is simply not selected:
 * later stages register their own handlers, and an unrouted message waits instead of failing.
 */
export interface OutboxRoute {
  readonly topic: string;
  readonly jobType: JobType;
  idempotencyKey(message: OutboxMessageRow): string;
  payload(message: OutboxMessageRow): Record<string, unknown>;
  payloadVersion?: number;
}

/** MED-02 routes the media processing message; every other topic waits for its own stage. */
export const mediaProcessingRoute: OutboxRoute = Object.freeze({
  topic: 'media.process-asset.v1',
  jobType: 'media.process-v1',
  idempotencyKey: (message: OutboxMessageRow) => `media.process-v1:${message.aggregateId}`,
  payload: (message: OutboxMessageRow) => ({
    assetId: message.aggregateId,
    mimeType: message.payload.mimeType ?? null,
  }),
  payloadVersion: 1,
});

export const defaultOutboxRoutes: readonly OutboxRoute[] = Object.freeze([mediaProcessingRoute]);

export interface DispatchSummary {
  dispatched: number;
  /** Already published, or locked by another dispatcher; nothing is wrong with these. */
  skipped: number;
  failed: number;
}

/**
 * Turns committed outbox messages into jobs (blueprint section 8.10). Each message is handled in
 * its own short Kysely transaction that locks the row with `for update skip locked`, creates or
 * wakes the idempotent job and marks the row published together - so a job is never created
 * without the message being marked, and a message is never marked without its job.
 */
export class OutboxDispatcher<Database> {
  private readonly routes: ReadonlyMap<string, OutboxRoute>;

  constructor(
    private readonly database: Kysely<Database>,
    private readonly jobs: JobRepository<Database>,
    routes: readonly OutboxRoute[] = defaultOutboxRoutes,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {
    this.routes = new Map(routes.map((route) => [route.topic, route]));
  }

  get routedTopics(): string[] {
    return [...this.routes.keys()];
  }

  async dispatchDue(limit = 50): Promise<DispatchSummary> {
    const summary: DispatchSummary = { dispatched: 0, skipped: 0, failed: 0 };
    if (!this.routes.size) return summary;
    const now = this.now();
    const { rows } = await sql<{ id: string }>`
      select id from outbox
        where published_at is null and available_at <= ${now}
          and topic in (${sql.join([...this.routes.keys()])})
        order by available_at asc, created_at asc, id asc
        limit ${limit}
    `.execute(this.database);
    for (const row of rows) summary[await this.dispatchOne(row.id)] += 1;
    return summary;
  }

  /**
   * Dispatches one message. Returns false when the row was taken by another dispatcher, was
   * already published, or its job could not be created; only the last case is a failure that is
   * recorded on the message and retried with backoff.
   */
  private async dispatchOne(id: string): Promise<keyof DispatchSummary> {
    const now = this.now();
    try {
      return await this.database.transaction().execute(async (transaction) => {
        const { rows } = await sql<{
          id: string;
          topic: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: unknown;
          deduplication_key: string;
          attempt: number;
        }>`
          select id, topic, aggregate_type, aggregate_id, payload_json, deduplication_key, attempt
            from outbox where id = ${id}::uuid and published_at is null
            for update skip locked
        `.execute(transaction);
        const row = rows[0];
        if (!row) return 'skipped' as const;
        const route = this.routes.get(row.topic);
        if (!route) return 'skipped' as const;
        const message: OutboxMessageRow = {
          id: row.id,
          topic: row.topic,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          payload: (row.payload_json ?? {}) as Record<string, unknown>,
          deduplicationKey: row.deduplication_key,
          attempt: row.attempt,
        };
        await this.jobs.enqueue(
          {
            type: route.jobType,
            payload: route.payload(message),
            idempotencyKey: route.idempotencyKey(message),
            payloadVersion: route.payloadVersion ?? 1,
          },
          transaction,
        );
        await sql`
          update outbox set published_at = ${now}, attempt = attempt + 1,
            last_error_code = null, last_error_message = null
            where id = ${id}::uuid and published_at is null
        `.execute(transaction);
        return 'dispatched' as const;
      });
    } catch (error) {
      await this.recordFailure(id, error);
      return 'failed';
    }
  }

  /** A message whose job could not be created waits out the same backoff a job would. */
  private async recordFailure(id: string, error: unknown): Promise<void> {
    const now = this.now();
    const { rows } = await sql<{ attempt: number }>`
      select attempt from outbox where id = ${id}::uuid
    `.execute(this.database);
    const attempt = (rows[0]?.attempt ?? 0) + 1;
    const delay = backoffDelayMs(attempt, jobPolicy('media.process-v1'), this.random);
    await sql`
      update outbox set attempt = ${attempt}, available_at = ${new Date(now.getTime() + delay)},
        last_error_code = 'OUTBOX_DISPATCH_FAILED',
        last_error_message = ${truncateErrorMessage(error)}
        where id = ${id}::uuid and published_at is null
    `.execute(this.database);
  }
}
