import type { RuntimeConfiguration } from '@inventory-atlas/config';
import type { Kysely } from 'kysely';
import { CatalogMediaOwnerAdapter } from './catalog/media-owner-adapter.js';
import { ItemRepository } from './catalog/item-repository.js';
import { TransactionalAuditPort, TransactionalOutboxPort } from './infrastructure/index.js';
import {
  createBackgroundRuntime,
  type BackgroundRuntime,
  type JobLogger,
  type MediaBackgroundPorts,
} from './jobs/index.js';
import {
  ChildImageProcessor,
  LocalMediaStorage,
  MediaProcessingService,
  MediaRepository,
  MediaService,
  mediaCapabilityFixtures,
  type CapabilityReport,
  type ImageProcessingLimits,
  type MediaStoragePort,
} from './media/index.js';
/** Both repositories accept a narrow slice of the Prisma client; a full client satisfies both. */
type MediaPrismaClient = ConstructorParameters<typeof MediaRepository>[0] &
  ConstructorParameters<typeof ItemRepository>[0];

export interface MediaRuntime {
  storage: MediaStoragePort;
  repository: MediaRepository;
  media: MediaService;
  processing: MediaProcessingService;
  limits: ImageProcessingLimits;
  /** Decodes the committed fixtures; the caller decides what an unavailable codec means. */
  checkCapabilities(): Promise<CapabilityReport>;
  backgroundPorts: MediaBackgroundPorts;
}

/**
 * The decoding limits every deployment profile shares (blueprint section 12.2). Concurrency is
 * fixed at one libvips worker thread per child, which is the approved ceiling for the compact
 * profile and the default for the expanded one.
 */
export function imageProcessingLimits(configuration: RuntimeConfiguration): ImageProcessingLimits {
  return {
    maxInputBytes: configuration.mediaMaxUploadBytes,
    maxPixels: configuration.mediaMaxPixels,
    childRssMb: configuration.mediaChildRssMb,
    childTimeoutMs: configuration.mediaChildTimeoutMs,
    concurrency: 1,
  };
}

/**
 * Assembles the Media module once for every composition root. The API and the worker container
 * call this same function, so the processor, its limits and the maintenance behaviour cannot
 * diverge between the compact and expanded profiles.
 */
export function createMediaRuntime(
  configuration: RuntimeConfiguration,
  prisma: MediaPrismaClient,
): MediaRuntime {
  if (configuration.mediaDriver === 's3')
    throw new Error('S3 media is unavailable until the S3 storage adapter is installed.');
  if (!configuration.mediaLocalPath)
    throw new Error('MEDIA_LOCAL_PATH is required for local media.');
  const storage = new LocalMediaStorage(configuration.mediaLocalPath);
  const repository = new MediaRepository(prisma);
  const media = new MediaService(
    repository,
    storage,
    new CatalogMediaOwnerAdapter(new ItemRepository(prisma)),
    { audit: new TransactionalAuditPort(), outbox: new TransactionalOutboxPort() },
    configuration.mediaMaxUploadBytes,
  );
  const limits = imageProcessingLimits(configuration);
  const processor = new ChildImageProcessor(limits);
  const processing = new MediaProcessingService(
    repository,
    storage,
    processor,
    configuration.mediaMaxUploadBytes,
  );
  return {
    storage,
    repository,
    media,
    processing,
    limits,
    checkCapabilities: async () => processing.checkCapabilities(await mediaCapabilityFixtures()),
    backgroundPorts: {
      processJob: (payload, heartbeat) => processing.handleJob(payload, heartbeat),
      expireSessions: () => media.expireSessions(),
      collectOrphans: (limit) => media.collectOrphans(limit),
    },
  };
}

/**
 * Builds the shared background runtime for one host process. `compact` claims inside the API,
 * `worker` claims only in the worker container, and `disabled` never claims at all - so the two
 * deployment profiles cannot accidentally run two claim loops against one queue.
 */
export function createJobRuntime<Database>(
  configuration: RuntimeConfiguration,
  database: Kysely<Database>,
  ports: MediaBackgroundPorts,
  host: 'api' | 'worker',
  logger?: JobLogger,
): BackgroundRuntime {
  return createBackgroundRuntime(database, ports, {
    mode: configuration.jobRunnerMode,
    host,
    ...(logger ? { logger } : {}),
  });
}
