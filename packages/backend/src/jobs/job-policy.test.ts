import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  jobPolicy,
  jobStates,
  jobTypes,
  maximumMediaConcurrency,
  nextFailureState,
  normalizeProgress,
  truncateErrorMessage,
} from './job-policy.js';

describe('job policy', () => {
  it('declares the blueprint job states', () => {
    expect([...jobStates]).toEqual([
      'queued',
      'running',
      'succeeded',
      'retry_wait',
      'dead',
      'cancelled',
    ]);
  });

  it('keeps media decoding within the approved concurrency ceiling', () => {
    expect(jobPolicy('media.process-v1').concurrency).toBe(1);
    expect(maximumMediaConcurrency).toBe(2);
    for (const type of jobTypes) expect(jobPolicy(type).concurrency).toBeLessThanOrEqual(2);
  });

  it('separates the per-type reliability budgets', () => {
    expect(jobPolicy('media.process-v1').leaseMs).toBeLessThan(
      jobPolicy('portability.export-v1').leaseMs,
    );
    // Media work must be claimed before a bulk export queued at the same moment.
    expect(jobPolicy('media.process-v1').priority).toBeLessThan(
      jobPolicy('media.cleanup-v1').priority,
    );
  });

  it('heartbeats several times inside one lease', () => {
    for (const type of jobTypes) {
      const policy = jobPolicy(type);
      expect(policy.leaseMs / policy.heartbeatMs).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('backoff', () => {
  const policy = jobPolicy('media.process-v1');

  it('grows exponentially and never returns an immediate retry', () => {
    const first = backoffDelayMs(1, policy, () => 0);
    const second = backoffDelayMs(2, policy, () => 0);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first * 2);
  });

  it('stays inside the per-type ceiling however many attempts failed', () => {
    for (const attempt of [1, 3, 10, 40]) {
      const delay = backoffDelayMs(attempt, policy, () => 1);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(policy.backoffMaxMs);
    }
  });

  it('jitters so a batch that failed together does not retry together', () => {
    const low = backoffDelayMs(4, policy, () => 0);
    const high = backoffDelayMs(4, policy, () => 0.999);
    expect(high).toBeGreaterThan(low);
  });
});

describe('failure state', () => {
  const policy = jobPolicy('media.process-v1');

  it('retries while the attempt budget lasts', () => {
    expect(nextFailureState(1, policy, false)).toBe('retry_wait');
    expect(nextFailureState(policy.maxAttempts - 1, policy, false)).toBe('retry_wait');
  });

  it('goes dead when the budget is exhausted', () => {
    expect(nextFailureState(policy.maxAttempts, policy, false)).toBe('dead');
  });

  it('goes dead immediately for a permanent failure', () => {
    expect(nextFailureState(1, policy, true)).toBe('dead');
  });
});

describe('bounded progress and errors', () => {
  it('clamps progress width, key length and value length', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`key${index}`, index]),
    );
    expect(Object.keys(normalizeProgress(wide))).toHaveLength(12);
    const long = normalizeProgress({ note: 'x'.repeat(5_000) });
    expect(String(long.note)).toHaveLength(256);
  });

  it('drops nested structures rather than storing an unbounded document', () => {
    expect(normalizeProgress({ nested: { a: 1 }, list: [1, 2], ok: true })).toEqual({ ok: true });
    expect(normalizeProgress('not an object')).toEqual({});
  });

  it('collapses and truncates an error message to the stored column width', () => {
    expect(truncateErrorMessage(new Error('a\n  b'))).toBe('a b');
    expect(truncateErrorMessage('y'.repeat(2_000))).toHaveLength(512);
  });
});
