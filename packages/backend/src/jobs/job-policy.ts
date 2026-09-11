/**
 * Jobs domain policy (blueprint section 14). Everything here is pure: the states a job may hold,
 * the per-type reliability budget, and the backoff schedule. Persistence and execution live in
 * the repository and the runner.
 */

export const jobStates = [
  'queued',
  'running',
  'succeeded',
  'retry_wait',
  'dead',
  'cancelled',
] as const;
export type JobState = (typeof jobStates)[number];

/** The job types the MVP declares. Later stages register their own handlers for the rest. */
export const jobTypes = [
  'media.process-v1',
  'media.cleanup-v1',
  'search.rebuild-items-v1',
  'search.rebuild-subtree-v1',
  'labels.render-batch-v1',
  'portability.export-v1',
  'portability.import-validate-v1',
  'portability.import-apply-v1',
] as const;
export type JobType = (typeof jobTypes)[number];

export interface JobTypePolicy {
  /** How many workers of one runner may execute this type at the same time. */
  readonly concurrency: number;
  readonly maxAttempts: number;
  /** How long a claim stays valid without a heartbeat. */
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly priority: number;
  /** Whether an Admin may retry or cancel this type from the failed-job view. */
  readonly adminRecoverable: boolean;
}

const defaultPolicy: JobTypePolicy = Object.freeze({
  concurrency: 1,
  maxAttempts: 5,
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  backoffBaseMs: 5_000,
  backoffMaxMs: 15 * 60_000,
  priority: 100,
  adminRecoverable: true,
});

/**
 * Per-type concurrency separates media, import/export, reindex and label work so one slow kind
 * of job cannot starve the others. Media decoding stays at one child process per runner; the
 * blueprint allows at most two, and only after load testing.
 */
const policies: Readonly<Partial<Record<JobType, Partial<JobTypePolicy>>>> = Object.freeze({
  'media.process-v1': {
    concurrency: 1,
    maxAttempts: 4,
    leaseMs: 120_000,
    heartbeatMs: 20_000,
    priority: 50,
  },
  'media.cleanup-v1': { concurrency: 1, maxAttempts: 3, priority: 200 },
  'search.rebuild-items-v1': { concurrency: 1, leaseMs: 300_000, priority: 120 },
  'search.rebuild-subtree-v1': { concurrency: 1, leaseMs: 300_000, priority: 120 },
  'labels.render-batch-v1': { concurrency: 1, leaseMs: 180_000, priority: 80 },
  'portability.export-v1': { concurrency: 1, leaseMs: 600_000, priority: 300 },
  'portability.import-validate-v1': { concurrency: 1, leaseMs: 600_000, priority: 300 },
  'portability.import-apply-v1': {
    concurrency: 1,
    leaseMs: 600_000,
    priority: 300,
    adminRecoverable: false,
  },
});

export function jobPolicy(type: JobType): JobTypePolicy {
  return Object.freeze({ ...defaultPolicy, ...policies[type] });
}

export const maximumMediaConcurrency = 2;

/** Bounded progress payloads: a handler may not grow an unbounded document row by row. */
export const jobProgressLimits = Object.freeze({
  maxKeys: 12,
  maxValueLength: 256,
  maxErrorMessageLength: 512,
});

/**
 * A failure the handler knows cannot succeed on a retry — a malformed image, an unsupported
 * format, a payload that violates its own contract. It goes straight to dead state.
 */
export class JobPermanentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JobPermanentError';
  }
}

/**
 * Exponential backoff with full jitter, capped per type. Jitter matters because a batch of jobs
 * that failed together would otherwise retry together and reproduce the same overload.
 */
export function backoffDelayMs(
  attempt: number,
  policy: JobTypePolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(attempt, 16) - 1);
  const ceiling = Math.min(policy.backoffBaseMs * 2 ** exponent, policy.backoffMaxMs);
  // Half the window is guaranteed so a retry never becomes an immediate hot loop.
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/** The state a failed attempt lands in: another try, or dead once the budget is exhausted. */
export function nextFailureState(
  attempt: number,
  policy: JobTypePolicy,
  permanent: boolean,
): 'retry_wait' | 'dead' {
  return permanent || attempt >= policy.maxAttempts ? 'dead' : 'retry_wait';
}

export function truncateErrorMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text.replace(/\s+/gu, ' ').trim().slice(0, jobProgressLimits.maxErrorMessageLength);
}

/** Progress documents are clamped in both width and depth before they reach the database. */
export function normalizeProgress(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry))
    .slice(0, jobProgressLimits.maxKeys)
    .map(([key, entry]) => [
      key.slice(0, 64),
      typeof entry === 'string' ? entry.slice(0, jobProgressLimits.maxValueLength) : entry,
    ]);
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}
