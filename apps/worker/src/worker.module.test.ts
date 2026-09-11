import { describe, expect, it } from 'vitest';
import { imageProcessingLimits } from '@inventory-atlas/backend';
import type { RuntimeConfiguration } from '@inventory-atlas/config';
import { createWorkerApplication } from './main.js';
import { WORKER_RUNTIME, type WorkerRuntime } from './worker.runtime.js';

const configuration = {
  mediaMaxUploadBytes: 26_214_400,
  mediaMaxPixels: 40_000_000,
  mediaChildRssMb: 512,
  mediaChildTimeoutMs: 30_000,
} as RuntimeConfiguration;

describe('worker composition root', () => {
  it('registers the runtime and closes the application context', async () => {
    const runtime = { start: () => {} } as unknown as WorkerRuntime;
    const app = await createWorkerApplication(runtime);
    expect(app.get(WORKER_RUNTIME)).toBe(runtime);
    await app.close();
  });

  it('derives the same processing limits as the compact profile', () => {
    // Both profiles read the limits from one factory, so a worker container can never decode
    // under a different pixel, byte, memory or timeout budget than the API.
    expect(imageProcessingLimits({ ...configuration, jobRunnerMode: 'worker' })).toEqual(
      imageProcessingLimits({ ...configuration, jobRunnerMode: 'compact' }),
    );
    expect(imageProcessingLimits(configuration)).toEqual({
      maxInputBytes: 26_214_400,
      maxPixels: 40_000_000,
      childRssMb: 512,
      childTimeoutMs: 30_000,
      concurrency: 1,
    });
  });
});
