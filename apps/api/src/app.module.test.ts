import { describe, expect, it } from 'vitest';
import type { FoundationRuntimePort } from './foundation.runtime.js';
import { createApiApplication } from './main.js';

const runtime: FoundationRuntimePort = {
  async readiness() {
    return {
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    };
  },
  metadata() {
    return {
      apiVersion: 'v1',
      buildVersion: 'test',
      buildRevision: 'test-revision',
      schemaVersion: '0001_foundation',
      supportedLocales: ['en', 'uk'],
    };
  },
  trustProxy() {
    return false;
  },
};

describe('API composition root', () => {
  it('initializes and closes the Fastify application', async () => {
    const app = await createApiApplication(runtime);
    await app.init();
    expect(app.getHttpAdapter().getType()).toBe('fastify');
    await app.close();
  });

  it('reports process health for container startup ordering', async () => {
    const app = await createApiApplication(runtime);
    await app.init();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    });

    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toEqual(runtime.metadata());

    await app.close();
  });

  it('returns actionable component states when readiness fails', async () => {
    const unreadyRuntime: FoundationRuntimePort = {
      ...runtime,
      async readiness() {
        return {
          status: 'unready',
          components: {
            database: 'unavailable',
            schema: 'unavailable',
            mediaStorage: 'ready',
            mediaCapabilities: 'ready',
          },
        };
      },
    };
    const app = await createApiApplication(unreadyRuntime);
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('database');
    expect(response.body).toContain('unavailable');

    await app.close();
  });
});
