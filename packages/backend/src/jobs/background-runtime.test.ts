import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createBackgroundRuntime, type MediaBackgroundPorts } from './background-runtime.js';

// Nothing here reaches the database: only the decision of which process claims is under test.
const database = {} as Kysely<Record<string, never>>;
const ports: MediaBackgroundPorts = {
  processJob: async () => ({}),
  expireSessions: async () => [],
  collectOrphans: async () => ({ deleted: [], retained: [] }),
};

function claims(mode: 'compact' | 'worker' | 'disabled', host: 'api' | 'worker'): boolean {
  return createBackgroundRuntime(database, ports, { mode, host }).enabled;
}

describe('background runtime profiles', () => {
  it('claims inside the API only in compact mode', () => {
    expect(claims('compact', 'api')).toBe(true);
    expect(claims('worker', 'api')).toBe(false);
    expect(claims('disabled', 'api')).toBe(false);
  });

  it('claims inside the worker container only in the expanded profile', () => {
    expect(claims('worker', 'worker')).toBe(true);
    expect(claims('compact', 'worker')).toBe(false);
    expect(claims('disabled', 'worker')).toBe(false);
  });

  it('never leaves two claim loops running against one queue', () => {
    for (const mode of ['compact', 'worker', 'disabled'] as const)
      expect([claims(mode, 'api'), claims(mode, 'worker')].filter(Boolean).length).toBeLessThan(2);
  });

  it('registers the media processing and cleanup handlers with a media-first priority', () => {
    const runtime = createBackgroundRuntime(database, ports, { mode: 'worker', host: 'worker' });
    expect(runtime.runner).not.toBeNull();
    expect(runtime.runner!.concurrencyFor('media.process-v1')).toBe(1);
  });

  it('stops cleanly when it never started claiming', async () => {
    const runtime = createBackgroundRuntime(database, ports, { mode: 'disabled', host: 'api' });
    runtime.start();
    await expect(runtime.stop()).resolves.toBeUndefined();
    expect(runtime.runner).toBeNull();
  });
});
