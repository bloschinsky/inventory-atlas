import { writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { JobPermanentError } from '../jobs/job-policy.js';
import { ImageProcessingError, type ImageProcessorPort } from './image-processor.js';
import { variantStorageKey } from './image-variants.js';
import { JobLeaseLostError, MediaProcessingService } from './media-processing-service.js';
import type { MediaAssetRecord, MediaRepository } from './media-repository.js';
import type { MediaStoragePort } from './media-storage.js';

const sourceAsset: MediaAssetRecord = {
  id: 'asset-1',
  storageKey: 'assets/as/se/asset1.jpg',
  originalFilename: 'front.jpg',
  mimeType: 'image/jpeg',
  byteSize: 2_048,
  width: null,
  height: null,
  checksumSha256: 'a'.repeat(64),
  processingState: 'pending',
  sourceAssetId: null,
  deleteAfter: null,
  createdAt: new Date(0),
};

function processorStub(overrides: Partial<ImageProcessorPort> = {}): ImageProcessorPort {
  return {
    probe: async () => ({
      width: 4_000,
      height: 3_000,
      bands: 3,
      loader: 'jpegload',
      orientation: null,
      byteSize: 2_048,
    }),
    // The real processor leaves a file behind for the service to stream into storage.
    render: async (input) => {
      await writeFile(input.targetPath, Buffer.alloc(64, 3));
      return {
        name: input.variant.name,
        path: input.targetPath,
        width: input.variant.maxEdge,
        height: input.variant.maxEdge,
        mimeType: input.variant.mimeType,
      };
    },
    checkCapabilities: async () => ({ available: true, results: [], checkedAt: new Date(0) }),
    ...overrides,
  };
}

function repositoryStub(asset: MediaAssetRecord | null = sourceAsset) {
  const replaced: { name: string; storageKey: string }[] = [];
  const processed: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const repository = {
    findAsset: async () => asset,
    listVariants: async () => [],
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({}),
    replaceVariants: async (
      _transaction: unknown,
      _sourceAssetId: string,
      variants: readonly { name: string; storageKey: string }[],
    ) => {
      replaced.push(...variants.map((variant) => ({ ...variant })));
      return [];
    },
    markAssetProcessed: async (
      _transaction: unknown,
      _id: string,
      input: { metadata: Record<string, unknown> },
    ) => {
      processed.push(input.metadata);
    },
    markAssetFailed: async (_id: string, code: string) => {
      failures.push(code);
    },
  } as unknown as MediaRepository;
  return { repository, replaced, processed, failures };
}

function storageStub() {
  const promoted: [string, string][] = [];
  const storage = {
    materialize: async () => ({ path: '/media/source.jpg', dispose: async () => {} }),
    writeTemp: async (_key: string, source: Readable) => {
      // Draining matters: the service hands over a live stream, and an abandoned one would
      // surface later as an unhandled error rather than a test failure.
      for await (const _chunk of source) void _chunk;
      return { byteSize: 512, checksumSha256: 'b'.repeat(64), head: new Uint8Array() };
    },
    promote: async (from: string, to: string) => {
      promoted.push([from, to]);
    },
  } as unknown as MediaStoragePort;
  return { storage, promoted };
}

describe('media processing service', () => {
  it('writes the planned variants and publishes the asset with technical metadata only', async () => {
    const { repository, replaced, processed } = repositoryStub();
    const { storage, promoted } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);

    const outcome = await service.processAsset('asset-1');

    expect(outcome).toMatchObject({ state: 'processed', width: 4_000, height: 3_000 });
    expect(outcome.variants).toEqual(['thumb', 'card', 'preview']);
    expect(replaced.map((variant) => variant.storageKey)).toEqual([
      variantStorageKey('asset-1', 'thumb'),
      variantStorageKey('asset-1', 'card'),
      variantStorageKey('asset-1', 'preview'),
    ]);
    expect(promoted).toHaveLength(3);
    expect(processed[0]).toMatchObject({ metadataStripped: true, loader: 'jpegload' });
    // Nothing that could identify a place, a device or a person reaches the row.
    expect(JSON.stringify(processed[0]).toLowerCase()).not.toMatch(/gps|make|model|artist|serial/u);
  });

  it('records the upright dimensions for a rotated source', async () => {
    const { repository, processed } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(
      repository,
      storage,
      processorStub({
        probe: async () => ({
          width: 4_000,
          height: 3_000,
          bands: 3,
          loader: 'jpegload',
          orientation: 6,
          byteSize: 2_048,
        }),
      }),
      1_000_000,
    );

    const outcome = await service.processAsset('asset-1');

    expect(outcome).toMatchObject({ width: 3_000, height: 4_000 });
    expect(processed[0]).toMatchObject({ orientationApplied: true });
  });

  it('never processes a variant as if it were a source image', async () => {
    const { repository } = repositoryStub({ ...sourceAsset, sourceAssetId: 'asset-1' });
    const { storage, promoted } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);

    expect(await service.processAsset('variant-1')).toMatchObject({ state: 'skipped' });
    expect(promoted).toHaveLength(0);
  });

  it('marks the asset failed and reports a permanent job failure for an undecodable image', async () => {
    const { repository, failures } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(
      repository,
      storage,
      processorStub({
        probe: async () => {
          throw new ImageProcessingError('MEDIA_DECODE_UNSUPPORTED', 'not an image', true);
        },
      }),
      1_000_000,
    );

    await expect(service.processAsset('asset-1')).rejects.toBeInstanceOf(JobPermanentError);
    expect(failures).toEqual(['MEDIA_DECODE_UNSUPPORTED']);
  });

  it('leaves the asset pending for a retryable failure', async () => {
    const { repository, failures } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(
      repository,
      storage,
      processorStub({
        probe: async () => {
          throw new ImageProcessingError('MEDIA_PROCESSING_TIMEOUT', 'too slow', false);
        },
      }),
      1_000_000,
    );

    await expect(service.processAsset('asset-1')).rejects.toMatchObject({
      code: 'MEDIA_PROCESSING_TIMEOUT',
    });
    expect(failures).toEqual([]);
  });

  it('abandons the attempt when the lease is lost mid-decode', async () => {
    const { repository, processed } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);
    const heartbeat = vi.fn(async () => false);

    await expect(service.processAsset('asset-1', heartbeat)).rejects.toBeInstanceOf(
      JobLeaseLostError,
    );
    // Nothing was published: another runner already owns the asset.
    expect(processed).toEqual([]);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload that names no asset', async () => {
    const { repository } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);

    await expect(service.handleJob({})).rejects.toMatchObject({
      code: 'MEDIA_JOB_PAYLOAD_INVALID',
    });
  });

  it('returns a bounded progress document from the job handler', async () => {
    const { repository } = repositoryStub();
    const { storage } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);

    expect(await service.handleJob({ assetId: 'asset-1' })).toEqual({
      assetId: 'asset-1',
      state: 'processed',
      variants: 'thumb,card,preview',
    });
  });

  it('reports a missing asset as permanently unprocessable', async () => {
    const { repository } = repositoryStub(null);
    const { storage } = storageStub();
    const service = new MediaProcessingService(repository, storage, processorStub(), 1_000_000);

    await expect(service.processAsset('gone')).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
  });
});
