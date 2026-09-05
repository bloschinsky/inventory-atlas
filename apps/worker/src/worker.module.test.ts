import { describe, expect, it } from 'vitest';
import { createWorkerApplication } from './main.js';

describe('worker composition root', () => {
  it('initializes and closes the application context', async () => {
    const app = await createWorkerApplication();
    expect(app).toBeDefined();
    await app.close();
  });
});
