import { PrismaPg } from '@prisma/adapter-pg';
import {
  ConfigurationError,
  resolveBootstrapSettings,
  type BootstrapSettings,
  type PublicCatalogMode,
  type RuntimeConfiguration,
  type SupportedLocale,
} from '@inventory-atlas/config';
import { PrismaClient } from './generated/prisma/client.js';
import type { AuthorizationSettings, Capability } from './auth/authorization.js';

const configurableAdminCapabilities = [
  'manageUsers',
  'manageSettings',
  'managePortability',
  'manageIntegrations',
  'manageAudit',
  'manageJobs',
] as const satisfies readonly Capability[];

export function createSettingsClient(
  connectionString: string,
  maxConnections: number,
): PrismaClient {
  const schema = new URL(connectionString).searchParams.get('schema') ?? undefined;
  const adapter = new PrismaPg(
    { connectionString, max: maxConnections },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

export async function initializeInstallationSettings(
  prisma: PrismaClient,
  configuration: RuntimeConfiguration,
  warn: (message: string) => void,
): Promise<{ settings: BootstrapSettings; initializedAt: Date }> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select 1::integer as acquired
      from (select pg_advisory_xact_lock(hashtext('inventory-atlas:settings-bootstrap'))) as bootstrap_lock
    `;
    const metadata = await transaction.installationMetadata.findUnique({
      where: { singleton: true },
    });

    if (!metadata) {
      const initializedAt = new Date();
      await transaction.appSetting.createMany({
        data: [
          {
            settingKey: 'app_base_url',
            valueText: configuration.appBaseUrl,
            updatedAt: initializedAt,
          },
          {
            settingKey: 'default_locale',
            valueText: configuration.defaultLocale,
            updatedAt: initializedAt,
          },
          {
            settingKey: 'public_catalog_mode',
            valueText: configuration.publicCatalogMode,
            updatedAt: initializedAt,
          },
          {
            settingKey: 'admin_capabilities',
            valueText: 'manageUsers,manageSettings',
            updatedAt: initializedAt,
          },
        ],
      });
      await transaction.installationMetadata.create({
        data: { singleton: true, settingsInitializedAt: initializedAt },
      });
      return {
        settings: {
          appBaseUrl: configuration.appBaseUrl,
          defaultLocale: configuration.defaultLocale,
          publicCatalogMode: configuration.publicCatalogMode,
        },
        initializedAt,
      };
    }

    const rows = await transaction.appSetting.findMany();
    if (
      rows.some(
        (row) =>
          !['app_base_url', 'default_locale', 'public_catalog_mode', 'admin_capabilities'].includes(
            row.settingKey,
          ),
      )
    ) {
      throw new ConfigurationError(
        'CONFIG_DATABASE_SETTINGS_UNKNOWN',
        'Database installation settings contain an unsupported key.',
      );
    }
    const values = new Map(rows.map((row) => [row.settingKey, row.valueText]));
    const appBaseUrl = values.get('app_base_url');
    const locale = values.get('default_locale');
    const catalogMode = values.get('public_catalog_mode');
    if (
      !appBaseUrl ||
      !['en', 'uk'].includes(locale ?? '') ||
      !['public', 'authenticated'].includes(catalogMode ?? '')
    ) {
      throw new ConfigurationError(
        'CONFIG_DATABASE_SETTINGS_INVALID',
        'Database installation settings are missing or invalid.',
      );
    }
    const settings = resolveBootstrapSettings(
      configuration,
      {
        appBaseUrl,
        defaultLocale: locale as SupportedLocale,
        publicCatalogMode: catalogMode as PublicCatalogMode,
      },
      warn,
    );
    return { settings, initializedAt: metadata.settingsInitializedAt };
  });
}

export async function readAdminAuthorizationSettings(
  prisma: PrismaClient,
): Promise<AuthorizationSettings> {
  const row = await prisma.appSetting.findUnique({ where: { settingKey: 'admin_capabilities' } });
  const values = (row?.valueText ?? 'manageUsers,manageSettings')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => !configurableAdminCapabilities.includes(value as never))) {
    throw new ConfigurationError(
      'CONFIG_ADMIN_CAPABILITIES_INVALID',
      'admin_capabilities contains an unsupported capability.',
    );
  }
  return {
    adminGrants: values as NonNullable<AuthorizationSettings['adminGrants']>,
  };
}
