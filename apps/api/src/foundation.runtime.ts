import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  AuthAdministrationService,
  AuthRateLimiter,
  CatalogDictionaryRepository,
  CatalogDictionaryService,
  createDatabase,
  createSettingsClient,
  currentSchemaVersion,
  expectedSchemaVersion,
  FieldDefinitionRepository,
  FieldDefinitionService,
  IdempotencyRepository,
  initializeInstallationSettings,
  readAdminAuthorizationSettings,
  SessionService,
  createJobRuntime,
  createMediaRuntime,
  ItemRepository,
  ItemService,
  MediaService,
  TransactionalAttributeValuePort,
  TransactionalAuditPort,
  TransactionalIdempotencyPort,
  TransactionalMovementHistoryPort,
  TransactionalOutboxPort,
  TransactionalSearchProjectionPort,
  StorageRepository,
  StorageService,
  type StorageDatabase,
} from '@inventory-atlas/backend';
import type { BackgroundRuntime, CapabilityReport } from '@inventory-atlas/backend';
import {
  parseEnvironment,
  supportedLocales,
  type RuntimeConfiguration,
} from '@inventory-atlas/config';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { AuthRuntimePort } from './auth.runtime.js';
import type { CatalogRuntimePort } from './catalog.runtime.js';
import type { SchemaRuntimePort } from './schema.runtime.js';
import type { ItemsRuntimePort } from './items.runtime.js';
import type { StorageRuntimePort } from './storage.runtime.js';
import type { Kysely } from 'kysely';

export const FOUNDATION_RUNTIME = Symbol('FOUNDATION_RUNTIME');

export interface ReadinessSnapshot {
  status: 'ready' | 'unready';
  components: {
    database: 'ready' | 'unavailable';
    schema: 'ready' | 'mismatch' | 'unavailable';
    mediaStorage: 'ready' | 'unavailable' | 'not-applicable';
    mediaCapabilities: 'ready' | 'unavailable';
  };
}

export interface FoundationRuntimePort {
  readiness(): Promise<ReadinessSnapshot>;
  metadata(): {
    apiVersion: 'v1';
    buildVersion: string;
    buildRevision: string;
    schemaVersion: string | null;
    supportedLocales: readonly string[];
  };
  trustProxy(): boolean | string | string[];
}

export class FoundationRuntime
  implements
    FoundationRuntimePort,
    AuthRuntimePort,
    CatalogRuntimePort,
    SchemaRuntimePort,
    ItemsRuntimePort,
    StorageRuntimePort,
    OnApplicationShutdown
{
  private schemaVersion: string | null = null;
  private capabilities: CapabilityReport | null = null;
  private background: BackgroundRuntime | null = null;
  private checkCapabilities: (() => Promise<CapabilityReport>) | null = null;
  private sessions: SessionService | null = null;
  private administration: AuthAdministrationService | null = null;
  private dictionaries: CatalogDictionaryService | null = null;
  private schemaFieldService: FieldDefinitionService | null = null;
  private itemService: ItemService | null = null;
  private storageService: StorageService | null = null;
  private mediaService: MediaService | null = null;
  private readonly rateLimiter: AuthRateLimiter;

  private constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly database: ReturnType<typeof createDatabase>,
    private readonly settingsClient: ReturnType<typeof createSettingsClient>,
  ) {
    this.rateLimiter = new AuthRateLimiter(configuration.sessionSecret);
  }

  static async create(
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<FoundationRuntime> {
    const configuration = parseEnvironment(environment);
    const database = createDatabase(configuration.kyselyDatabaseUrl, configuration.kyselyPoolMax);
    const settingsClient = createSettingsClient(
      configuration.databaseUrl,
      configuration.prismaPoolMax,
    );
    const runtime = new FoundationRuntime(configuration, database, settingsClient);
    try {
      runtime.schemaVersion = await currentSchemaVersion(database);
      if (runtime.schemaVersion !== expectedSchemaVersion) {
        throw new Error(
          `Database schema ${runtime.schemaVersion ?? 'uninitialized'} does not match ${expectedSchemaVersion}.`,
        );
      }
      await initializeInstallationSettings(settingsClient, configuration, (message) =>
        Logger.warn(message, FoundationRuntime.name),
      );
      const authorizationSettings = await readAdminAuthorizationSettings(settingsClient);
      runtime.sessions = new SessionService(settingsClient, configuration.sessionSecret, {
        authorizationSettings,
      });
      runtime.administration = new AuthAdministrationService(
        settingsClient,
        configuration.sessionSecret,
        authorizationSettings,
      );
      const dictionaryRepository = new CatalogDictionaryRepository(settingsClient);
      const fieldRepository = new FieldDefinitionRepository(settingsClient);
      runtime.dictionaries = new CatalogDictionaryService(dictionaryRepository, fieldRepository);
      const attributeValues = new TransactionalAttributeValuePort();
      runtime.schemaFieldService = new FieldDefinitionService(fieldRepository, attributeValues);
      const itemRepository = new ItemRepository(settingsClient);
      runtime.itemService = new ItemService(
        itemRepository,
        new IdempotencyRepository(database),
        fieldRepository,
        {
          attributes: attributeValues,
          audit: new TransactionalAuditPort(),
          idempotency: new TransactionalIdempotencyPort(),
          movements: new TransactionalMovementHistoryPort(),
          outbox: new TransactionalOutboxPort(),
          search: new TransactionalSearchProjectionPort(),
        },
        dictionaryRepository,
      );
      const storageRepository = new StorageRepository(
        database as unknown as Kysely<StorageDatabase>,
      );
      runtime.storageService = new StorageService(storageRepository, fieldRepository, {
        attributes: attributeValues,
        audit: new TransactionalAuditPort(),
        outbox: new TransactionalOutboxPort(),
        search: new TransactionalSearchProjectionPort(),
      });
      const mediaRuntime = createMediaRuntime(configuration, settingsClient);
      runtime.mediaService = mediaRuntime.media;
      runtime.checkCapabilities = mediaRuntime.checkCapabilities;
      await runtime.verifyMediaStorage();
      // Startup decode check (blueprint section 12.2): a deployment whose image cannot read an
      // approved format says so here instead of discovering it on the first upload.
      runtime.capabilities = await mediaRuntime.checkCapabilities();
      if (!runtime.capabilities.available) {
        for (const result of runtime.capabilities.results.filter((entry) => !entry.decoded))
          Logger.error(
            `Media capability check failed for ${result.format}: ${result.errorCode}.`,
            FoundationRuntime.name,
          );
      }
      // Compact mode claims jobs in this process; the expanded profile leaves them to the worker.
      runtime.background = createJobRuntime(
        configuration,
        database,
        mediaRuntime.backgroundPorts,
        'api',
        {
          info: (message, detail) => Logger.log(formatJobLog(message, detail), 'JobRunner'),
          warn: (message, detail) => Logger.warn(formatJobLog(message, detail), 'JobRunner'),
          error: (message, detail) => Logger.error(formatJobLog(message, detail), 'JobRunner'),
        },
      );
      runtime.background.start();
      return runtime;
    } catch (error) {
      await database.destroy();
      await settingsClient.$disconnect();
      throw error;
    }
  }

  async readiness(): Promise<ReadinessSnapshot> {
    let databaseState: ReadinessSnapshot['components']['database'] = 'ready';
    let schemaState: ReadinessSnapshot['components']['schema'] = 'ready';
    let mediaStorage: ReadinessSnapshot['components']['mediaStorage'] =
      this.configuration.mediaDriver === 'local' ? 'ready' : 'unavailable';
    let mediaCapabilities: ReadinessSnapshot['components']['mediaCapabilities'] = 'ready';

    try {
      this.schemaVersion = await currentSchemaVersion(this.database);
      if (this.schemaVersion !== expectedSchemaVersion) schemaState = 'mismatch';
    } catch {
      databaseState = 'unavailable';
      schemaState = 'unavailable';
    }
    try {
      await this.verifyMediaStorage();
    } catch {
      if (this.configuration.mediaDriver === 'local') mediaStorage = 'unavailable';
    }
    if (!(await this.mediaCapabilities()).available) mediaCapabilities = 'unavailable';

    const components = {
      database: databaseState,
      schema: schemaState,
      mediaStorage,
      mediaCapabilities,
    };
    return {
      status: Object.values(components).every((state) =>
        ['ready', 'not-applicable'].includes(state),
      )
        ? 'ready'
        : 'unready',
      components,
    };
  }

  metadata(): ReturnType<FoundationRuntimePort['metadata']> {
    return {
      apiVersion: 'v1',
      buildVersion: this.configuration.appVersion,
      buildRevision: this.configuration.buildRevision,
      schemaVersion: this.schemaVersion,
      supportedLocales,
    };
  }

  trustProxy(): boolean | string | string[] {
    return this.configuration.trustProxy;
  }

  authSessions(): SessionService {
    if (!this.sessions) throw new Error('Auth sessions are not initialized.');
    return this.sessions;
  }

  authAdministration(): AuthAdministrationService {
    if (!this.administration) throw new Error('Auth administration is not initialized.');
    return this.administration;
  }

  authRateLimiter(): AuthRateLimiter {
    return this.rateLimiter;
  }

  catalogDictionaries(): CatalogDictionaryService {
    if (!this.dictionaries) throw new Error('Catalog dictionaries are not initialized.');
    return this.dictionaries;
  }

  schemaFields(): FieldDefinitionService {
    if (!this.schemaFieldService) throw new Error('Dynamic schema is not initialized.');
    return this.schemaFieldService;
  }

  catalogItems(): ItemService {
    if (!this.itemService) throw new Error('Catalog Items are not initialized.');
    return this.itemService;
  }

  storage(): StorageService {
    if (!this.storageService) throw new Error('Storage is not initialized.');
    return this.storageService;
  }

  media(): MediaService {
    if (!this.mediaService) throw new Error('Media is not initialized.');
    return this.mediaService;
  }

  secureSessionCookies(): boolean {
    return this.configuration.cookieSecure;
  }

  /** The decode capabilities this deployment actually has, per approved format. */
  mediaCapabilityReport(): CapabilityReport | null {
    return this.capabilities;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.background?.stop();
    await Promise.all([this.database.destroy(), this.settingsClient.$disconnect()]);
  }

  private async verifyMediaStorage(): Promise<void> {
    if (this.configuration.mediaDriver === 's3') {
      throw new Error('S3 media readiness is unavailable until the S3 adapter is installed.');
    }
    const mediaPath = this.configuration.mediaLocalPath;
    if (!mediaPath) throw new Error('MEDIA_LOCAL_PATH is required for local media.');
    await mkdir(mediaPath, { recursive: true });
    await access(mediaPath, constants.R_OK | constants.W_OK);
  }

  /**
   * Readiness reuses the startup report and only re-decodes the fixtures once the cache ages
   * out: a probe every ten seconds must not spawn a decoder every ten seconds.
   */
  private async mediaCapabilities(): Promise<CapabilityReport> {
    const cached = this.capabilities;
    if (cached && Date.now() - cached.checkedAt.getTime() < capabilityCacheMs) return cached;
    if (!this.checkCapabilities) return { available: false, results: [], checkedAt: new Date() };
    try {
      this.capabilities = await this.checkCapabilities();
    } catch {
      this.capabilities = { available: false, results: [], checkedAt: new Date() };
    }
    return this.capabilities;
  }
}

const capabilityCacheMs = 5 * 60_000;

/** Job logs carry identifiers and codes only; no payload, filename or decoder output. */
function formatJobLog(message: string, detail?: Record<string, unknown>): string {
  if (!detail || !Object.keys(detail).length) return message;
  return `${message} ${Object.entries(detail)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')}`;
}
