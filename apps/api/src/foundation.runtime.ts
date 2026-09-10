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
  ItemRepository,
  ItemService,
  TransactionalAttributeValuePort,
  TransactionalAuditPort,
  TransactionalIdempotencyPort,
  TransactionalMovementHistoryPort,
  TransactionalOutboxPort,
  TransactionalSearchProjectionPort,
} from '@inventory-atlas/backend';
import {
  parseEnvironment,
  supportedLocales,
  type RuntimeConfiguration,
} from '@inventory-atlas/config';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AuthRuntimePort } from './auth.runtime.js';
import type { CatalogRuntimePort } from './catalog.runtime.js';
import type { SchemaRuntimePort } from './schema.runtime.js';
import type { ItemsRuntimePort } from './items.runtime.js';

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
    OnApplicationShutdown
{
  private schemaVersion: string | null = null;
  private sessions: SessionService | null = null;
  private administration: AuthAdministrationService | null = null;
  private dictionaries: CatalogDictionaryService | null = null;
  private schemaFieldService: FieldDefinitionService | null = null;
  private itemService: ItemService | null = null;
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
      runtime.itemService = new ItemService(
        new ItemRepository(settingsClient),
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
      await runtime.verifyMedia();
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
      await this.verifyMedia();
    } catch {
      if (this.configuration.mediaDriver === 'local') mediaStorage = 'unavailable';
      mediaCapabilities = 'unavailable';
    }

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

  secureSessionCookies(): boolean {
    return this.configuration.cookieSecure;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.database.destroy(), this.settingsClient.$disconnect()]);
  }

  private async verifyMedia(): Promise<void> {
    if (this.configuration.mediaDriver === 's3') {
      throw new Error('S3 media readiness is unavailable until the S3 adapter is installed.');
    }
    const mediaPath = this.configuration.mediaLocalPath;
    if (!mediaPath) throw new Error('MEDIA_LOCAL_PATH is required for local media.');
    await mkdir(mediaPath, { recursive: true });
    await access(mediaPath, constants.R_OK | constants.W_OK);
    await Promise.all(
      [
        'capability-16x16.heic',
        'capability-16x16.jpg',
        'capability-16x16.png',
        'capability-16x16.webp',
      ].map((name) =>
        access(
          fileURLToPath(new URL(`../../../db/fixtures/media/${name}`, import.meta.url)),
          constants.R_OK,
        ),
      ),
    );
  }
}
