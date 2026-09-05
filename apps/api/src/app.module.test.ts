import { describe, expect, it } from 'vitest';
import { createApiApplication } from './main.js';

describe('API composition root', () => {
  it('initializes and closes the Fastify application', async () => {
    const app = await createApiApplication();
    await app.init();
    expect(app.getHttpAdapter().getType()).toBe('fastify');
    await app.close();
  });
});
