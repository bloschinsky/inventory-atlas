import { describe, expect, it, vi } from 'vitest';
import {
  ConfigurationError,
  defaultLocale,
  parseEnvironment,
  resolveBootstrapSettings,
  supportedLocales,
} from './index.js';

const validEnvironment = {
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://inventory.example.test',
  DATABASE_URL: 'postgresql://user:password@db:5432/inventory',
  KYSELY_DATABASE_URL: 'postgresql://user:password@db:5432/inventory',
  SESSION_SECRET: 'a-secure-session-secret-with-32-characters',
  COOKIE_SECURE: 'true',
  DEFAULT_LOCALE: 'en',
  PUBLIC_CATALOG_MODE: 'authenticated',
  MEDIA_DRIVER: 'local',
  MEDIA_LOCAL_PATH: '/var/lib/inventory-atlas/media',
  MEDIA_MAX_UPLOAD_BYTES: '26214400',
  MEDIA_MAX_PIXELS: '40000000',
  MEDIA_CHILD_RSS_MB: '512',
  MEDIA_CHILD_TIMEOUT_MS: '30000',
  JOB_RUNNER_MODE: 'compact',
  PRISMA_POOL_MAX: '6',
  KYSELY_POOL_MAX: '6',
  LOG_LEVEL: 'info',
  TRUST_PROXY: 'true',
};

describe('shared configuration', () => {
  it('uses English as the default locale', () => {
    expect(defaultLocale).toBe('en');
    expect(supportedLocales).toContain('uk');
  });

  it('parses the complete production environment', () => {
    expect(parseEnvironment(validEnvironment)).toMatchObject({
      nodeEnv: 'production',
      defaultLocale: 'en',
      mediaDriver: 'local',
      jobRunnerMode: 'compact',
    });
  });

  it('rejects unsafe production secrets and connection budgets', () => {
    expect(() => parseEnvironment({ ...validEnvironment, SESSION_SECRET: 'short' })).toThrowError(
      ConfigurationError,
    );
    expect(() => parseEnvironment({ ...validEnvironment, PRISMA_POOL_MAX: '7' })).toThrowError(
      /total at most 12/,
    );
  });

  it('fails production authority conflicts and lets the database locale win', () => {
    const config = parseEnvironment(validEnvironment);
    expect(() =>
      resolveBootstrapSettings(
        config,
        {
          appBaseUrl: 'https://other.example.test',
          defaultLocale: 'en',
          publicCatalogMode: 'authenticated',
        },
        vi.fn(),
      ),
    ).toThrowError(/APP_BASE_URL conflicts/);

    const warn = vi.fn();
    const effective = resolveBootstrapSettings(
      config,
      {
        appBaseUrl: config.appBaseUrl,
        defaultLocale: 'uk',
        publicCatalogMode: 'authenticated',
      },
      warn,
    );
    expect(effective.defaultLocale).toBe('uk');
    expect(warn).toHaveBeenCalledOnce();
  });
});
