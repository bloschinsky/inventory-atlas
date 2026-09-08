import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '@inventory-atlas/config';
import {
  createDatabase,
  currentSchemaVersion,
  expectedSchemaVersion,
  migrateToLatest,
} from './database.js';
import {
  createSettingsClient,
  initializeInstallationSettings,
  readAdminAuthorizationSettings,
} from './settings.repository.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `fnd02_${randomUUID().replaceAll('-', '')}`;
let adminPool: Pool;
let schemaUrl: string;

suite('foundation database lifecycle', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../db/migrations', import.meta.url)),
    );
  });

  afterAll(async () => {
    await adminPool.query(`drop schema "${schema}" cascade`);
    await adminPool.end();
  });

  it('migrates, initializes once, and applies database setting authority', async () => {
    const database = createDatabase(schemaUrl, 2);
    const settingsClient = createSettingsClient(schemaUrl, 2);
    const base = {
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://inventory.example.test',
      DATABASE_URL: schemaUrl,
      KYSELY_DATABASE_URL: schemaUrl,
      SESSION_SECRET: 'a-secure-session-secret-with-32-characters',
      COOKIE_SECURE: 'true',
      DEFAULT_LOCALE: 'en',
      PUBLIC_CATALOG_MODE: 'authenticated',
      MEDIA_DRIVER: 'local',
      MEDIA_LOCAL_PATH: '/tmp/inventory-atlas-test',
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

    try {
      expect(await currentSchemaVersion(database)).toBe(expectedSchemaVersion);
      const first = await initializeInstallationSettings(
        settingsClient,
        parseEnvironment(base),
        vi.fn(),
      );
      const second = await initializeInstallationSettings(
        settingsClient,
        parseEnvironment(base),
        vi.fn(),
      );
      expect(second.initializedAt).toEqual(first.initializedAt);
      expect(await readAdminAuthorizationSettings(settingsClient)).toEqual({
        adminGrants: ['manageUsers', 'manageSettings'],
      });

      await settingsClient.appSetting.update({
        where: { settingKey: 'default_locale' },
        data: { valueText: 'uk' },
      });
      const warn = vi.fn();
      const effective = await initializeInstallationSettings(
        settingsClient,
        parseEnvironment(base),
        warn,
      );
      expect(effective.settings.defaultLocale).toBe('uk');
      expect(warn).toHaveBeenCalledOnce();

      await expect(
        initializeInstallationSettings(
          settingsClient,
          parseEnvironment({ ...base, APP_BASE_URL: 'https://conflict.example.test' }),
          vi.fn(),
        ),
      ).rejects.toThrow(/APP_BASE_URL conflicts/);

      await expect(
        initializeInstallationSettings(
          settingsClient,
          parseEnvironment({ ...base, PUBLIC_CATALOG_MODE: 'public' }),
          vi.fn(),
        ),
      ).rejects.toThrow(/PUBLIC_CATALOG_MODE conflicts/);

      await settingsClient.appSetting.update({
        where: { settingKey: 'admin_capabilities' },
        data: { valueText: 'manageUsers,manageAudit' },
      });
      expect(await readAdminAuthorizationSettings(settingsClient)).toEqual({
        adminGrants: ['manageUsers', 'manageAudit'],
      });
    } finally {
      await database.destroy();
      await settingsClient.$disconnect();
    }
  });
});
