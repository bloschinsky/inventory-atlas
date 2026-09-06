import { describe, expect, it } from 'vitest';
import {
  assertCompactModel,
  assertDevelopmentModel,
  assertOperationalModel,
} from './validate-compose.mjs';

const validModel = () => ({
  services: {
    db: { image: 'postgres:18.6@sha256:digest' },
    migrate: {},
    api: {},
    web: {},
    caddy: { image: 'caddy:2.11.4@sha256:digest' },
  },
  networks: { backend: { internal: true } },
  volumes: { postgres_data: {}, media_data: {}, caddy_data: {} },
});

const validOperationalModel = () => ({
  services: { backup: {}, restore: {} },
  volumes: { backup_data: {} },
});

describe('development isolation contract', () => {
  const model = () => {
    const volumes = [
      '',
      'apps/api/',
      'apps/worker/',
      'apps/web/',
      'packages/backend/',
      'packages/config/',
      'packages/contracts/',
      'packages/i18n/',
      'packages/testkit/',
      'packages/ui/',
    ].map((directory) => ({
      type: 'volume',
      target: `/workspace/${directory}node_modules`,
    }));
    return {
      services: {
        db: {},
        'test-db': {},
        install: { volumes: structuredClone(volumes) },
        dev: { volumes: structuredClone(volumes), ports: [{ host_ip: '127.0.0.1' }] },
        tools: {
          volumes: structuredClone(volumes),
          environment: {
            INTEGRATION_DATABASE_URL: 'postgresql://synthetic@test-db:5432/test',
          },
        },
      },
    };
  };

  it('accepts private databases and container-owned dependency directories', () => {
    expect(() => assertDevelopmentModel(model())).not.toThrow();
  });

  it('rejects host dependencies and Docker socket access in the dev server', () => {
    const hostDependencies = model();
    hostDependencies.services.dev.volumes[0].type = 'bind';
    expect(() => assertDevelopmentModel(hostDependencies)).toThrow(/dependency directory/);
    const socketAccess = model();
    socketAccess.services.dev.volumes.push({ type: 'bind', target: '/var/run/docker.sock' });
    expect(() => assertDevelopmentModel(socketAccess)).toThrow(/Only docker-tools/);
  });

  it('rejects integration tests pointed at the development database', () => {
    const unsafe = model();
    unsafe.services.tools.environment.INTEGRATION_DATABASE_URL =
      'postgresql://synthetic@db:5432/dev';
    expect(() => assertDevelopmentModel(unsafe)).toThrow(/separate test database/);
  });
});

describe('compact Compose contract', () => {
  it('accepts an isolated service graph with pinned external images', () => {
    expect(() => assertCompactModel(validModel())).not.toThrow();
  });

  it('rejects a publicly exposed database', () => {
    const model = validModel();
    model.services.db.ports = [{ published: '5432', target: 5432 }];
    expect(() => assertCompactModel(model)).toThrow(/must not publish/);
  });
});

describe('operational Compose contract', () => {
  it('requires backup and restore services with their persistent volume', () => {
    expect(() => assertOperationalModel(validOperationalModel())).not.toThrow();

    const missingVolume = validOperationalModel();
    delete missingVolume.volumes.backup_data;
    expect(() => assertOperationalModel(missingVolume)).toThrow(/backup_data/);
  });
});
