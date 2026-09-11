import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  createDatabase,
  createJobRuntime,
  createMediaRuntime,
  createSettingsClient,
  currentSchemaVersion,
  expectedSchemaVersion,
  type BackgroundRuntime,
  type CapabilityReport,
} from '@inventory-atlas/backend';
import { parseEnvironment, type RuntimeConfiguration } from '@inventory-atlas/config';

export const WORKER_RUNTIME = Symbol('WORKER_RUNTIME');

/**
 * The expanded deployment profile. It composes the Media module and the job runner through the
 * same backend factories the API uses in compact mode, so the two profiles run one processor
 * with one set of limits (blueprint section 12.2) rather than two similar implementations.
 */
export class WorkerRuntime implements OnApplicationShutdown {
  private constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly database: ReturnType<typeof createDatabase>,
    private readonly prisma: ReturnType<typeof createSettingsClient>,
    private readonly background: BackgroundRuntime,
    private readonly capabilities: CapabilityReport,
  ) {}

  static async create(
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<WorkerRuntime> {
    const configuration = parseEnvironment(environment);
    const database = createDatabase(configuration.kyselyDatabaseUrl, configuration.kyselyPoolMax);
    const prisma = createSettingsClient(configuration.databaseUrl, configuration.prismaPoolMax);
    try {
      const schemaVersion = await currentSchemaVersion(database);
      if (schemaVersion !== expectedSchemaVersion)
        throw new Error(
          `Database schema ${schemaVersion ?? 'uninitialized'} does not match ${expectedSchemaVersion}.`,
        );
      const media = createMediaRuntime(configuration, prisma);
      // The worker performs the same startup decode check as the API: a container without a
      // codec must be visible in the log before it starts failing user uploads.
      const capabilities = await media.checkCapabilities();
      for (const result of capabilities.results.filter((entry) => !entry.decoded))
        Logger.error(
          `Media capability check failed for ${result.format}: ${result.errorCode}.`,
          WorkerRuntime.name,
        );
      const background = createJobRuntime(
        configuration,
        database,
        media.backgroundPorts,
        'worker',
        {
          info: (message, detail) => Logger.log(format(message, detail), 'JobRunner'),
          warn: (message, detail) => Logger.warn(format(message, detail), 'JobRunner'),
          error: (message, detail) => Logger.error(format(message, detail), 'JobRunner'),
        },
      );
      return new WorkerRuntime(configuration, database, prisma, background, capabilities);
    } catch (error) {
      await database.destroy();
      await prisma.$disconnect();
      throw error;
    }
  }

  start(): void {
    this.background.start();
    Logger.log(`Worker started in ${this.configuration.jobRunnerMode} mode.`, WorkerRuntime.name);
  }

  mediaCapabilityReport(): CapabilityReport {
    return this.capabilities;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.background.stop();
    await Promise.all([this.database.destroy(), this.prisma.$disconnect()]);
  }
}

/** Job logs carry identifiers and codes only; no payload, filename or decoder output. */
function format(message: string, detail?: Record<string, unknown>): string {
  if (!detail || !Object.keys(detail).length) return message;
  return `${message} ${Object.entries(detail)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')}`;
}
