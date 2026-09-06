import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  createDatabase,
  createSettingsClient,
  currentSchemaVersion,
  expectedSchemaVersion,
  initializeInstallationSettings,
} from '@inventory-atlas/backend';
import {
  parseEnvironment,
  supportedLocales,
  type RuntimeConfiguration,
} from '@inventory-atlas/config';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export class FoundationRuntime implements FoundationRuntimePort, OnApplicationShutdown {
  private schemaVersion: string | null = null;

  private constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly database: ReturnType<typeof createDatabase>,
    private readonly settingsClient: ReturnType<typeof createSettingsClient>,
  ) {}

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
