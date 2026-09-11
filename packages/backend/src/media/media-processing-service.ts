import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobPermanentError } from '../jobs/job-policy.js';
import {
  ImageProcessingError,
  uprightDimensions,
  type CapabilityFixture,
  type CapabilityReport,
  type ImageProcessorPort,
} from './image-processor.js';
import { plannedVariants, variantStorageKey, type VariantName } from './image-variants.js';
import type { MediaRepository, MediaVariantInput } from './media-repository.js';
import type { MediaStoragePort } from './media-storage.js';

export interface ProcessAssetOutcome {
  assetId: string;
  state: 'processed' | 'skipped';
  width: number | null;
  height: number | null;
  variants: VariantName[];
}

export interface MediaProcessingLogger {
  warn(message: string, detail?: Record<string, unknown>): void;
}

/** The lease was reclaimed mid-decode; the attempt is abandoned rather than finished blind. */
export class JobLeaseLostError extends Error {
  readonly code = 'JOB_LEASE_LOST';

  constructor(message: string) {
    super(message);
    this.name = 'JobLeaseLostError';
  }
}

/**
 * MED-02 application service: the handler behind the `media.process-v1` job. It never decodes
 * anything itself - `ImageProcessorPort` owns that, in a capped one-shot child - and it never
 * lets a decoding failure escape as an unclassified error, so a hostile image can only ever
 * change one asset row and one job row.
 */
export class MediaProcessingService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: MediaStoragePort,
    private readonly processor: ImageProcessorPort,
    private readonly maxVariantBytes: number,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: MediaProcessingLogger = { warn: () => {} },
  ) {}

  /**
   * Decodes one asset, writes its variants and publishes it. Running twice is safe: the variant
   * rows are replaced inside one transaction and the storage keys are deterministic, so a retry
   * after a crash converges on the same result instead of accumulating objects.
   */
  async processAsset(
    assetId: string,
    heartbeat: () => Promise<unknown> = async () => true,
  ): Promise<ProcessAssetOutcome> {
    const keepLease = async (): Promise<void> => {
      // A lost lease means another runner already owns this asset. Stopping here avoids decoding
      // the same image twice; the work is idempotent either way, and the completion statement is
      // guarded by the worker ID, so nothing is published by a runner that no longer holds it.
      if ((await heartbeat()) === false)
        throw new JobLeaseLostError('The worker lease expired while the image was processing.');
    };
    const asset = await this.repository.findAsset(assetId);
    if (!asset)
      throw new JobPermanentError('MEDIA_ASSET_NOT_FOUND', 'The media asset no longer exists.');
    // A variant is itself an asset row; it is never a processing input.
    if (asset.sourceAssetId)
      return { assetId, state: 'skipped', width: asset.width, height: asset.height, variants: [] };

    const source = await this.storage.materialize(asset.storageKey);
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'atlas-media-'));
    try {
      const probe = await this.processor.probe(source.path);
      const upright = uprightDimensions(probe);
      const staged: (MediaVariantInput & { temporaryKey: string; name: VariantName })[] = [];
      for (const definition of plannedVariants(upright.width, upright.height)) {
        const producedPath = path.join(workspace, `${definition.name}.${definition.format}`);
        const rendered = await this.processor.render({
          sourcePath: source.path,
          targetPath: producedPath,
          variant: definition,
        });
        // The variant is streamed through the storage port so its checksum and byte size are
        // measured by the same code that measured the original upload.
        const temporaryKey = `tmp/variant-${asset.id}-${definition.name}`;
        const stored = await this.storage.writeTemp(
          temporaryKey,
          createReadStream(producedPath),
          this.maxVariantBytes,
        );
        staged.push({
          name: definition.name,
          temporaryKey,
          storageKey: variantStorageKey(asset.id, definition.name, definition.format),
          mimeType: definition.mimeType,
          byteSize: stored.byteSize,
          width: rendered.width,
          height: rendered.height,
          checksumSha256: stored.checksumSha256,
          originalFilename: variantFilename(asset.originalFilename, definition.name),
        });
        await keepLease();
      }

      for (const variant of staged)
        await this.storage.promote(variant.temporaryKey, variant.storageKey);
      const now = this.now();
      await this.repository.transaction(async (transaction) => {
        await this.repository.replaceVariants(transaction, asset.id, staged, now);
        await this.repository.markAssetProcessed(transaction, asset.id, {
          width: upright.width,
          height: upright.height,
          // Technical facts only. EXIF, XMP, IPTC and any GPS tag are removed from the produced
          // variants and are deliberately never persisted, logged or served.
          metadata: {
            processor: 'libvips',
            loader: probe.loader,
            sourceBands: probe.bands,
            orientationApplied: probe.orientation !== null,
            metadataStripped: true,
            processedAt: now.toISOString(),
          },
          now,
        });
      });
      return {
        assetId,
        state: 'processed',
        width: upright.width,
        height: upright.height,
        variants: staged.map((variant) => variant.name),
      };
    } catch (error) {
      await this.recordFailure(assetId, error);
      throw this.translate(error);
    } finally {
      await source.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  }

  /** The `media.process-v1` handler contract: one payload in, a bounded progress document out. */
  async handleJob(
    payload: Record<string, unknown>,
    heartbeat: () => Promise<unknown> = async () => true,
  ): Promise<Record<string, unknown>> {
    const assetId = typeof payload.assetId === 'string' ? payload.assetId : '';
    if (!assetId)
      throw new JobPermanentError(
        'MEDIA_JOB_PAYLOAD_INVALID',
        'The media processing payload names no asset.',
      );
    const outcome = await this.processAsset(assetId, heartbeat);
    return {
      assetId: outcome.assetId,
      state: outcome.state,
      variants: outcome.variants.join(','),
    };
  }

  /**
   * The startup capability check (blueprint section 12.2). It decodes the committed JPEG, PNG,
   * WebP and HEIC fixtures so a deployment without a codec reports it at readiness instead of
   * discovering it on the first upload.
   */
  checkCapabilities(fixtures: readonly CapabilityFixture[]): Promise<CapabilityReport> {
    return this.processor.checkCapabilities(fixtures);
  }

  /** Only a permanent failure marks the asset; a retryable one leaves it pending for the retry. */
  private async recordFailure(assetId: string, error: unknown): Promise<void> {
    if (!(error instanceof ImageProcessingError) || !error.permanent) return;
    try {
      await this.repository.markAssetFailed(assetId, error.code, this.now());
    } catch (failure) {
      this.logger.warn('media: could not record the processing failure', {
        assetId,
        code: error.code,
        reason: failure instanceof Error ? failure.name : 'unknown',
      });
    }
  }

  private translate(error: unknown): unknown {
    if (error instanceof ImageProcessingError && error.permanent)
      return new JobPermanentError(error.code, error.message);
    return error;
  }
}

/** Variant filenames stay recognizable without carrying anything the client supplied verbatim. */
function variantFilename(originalFilename: string, variant: VariantName): string {
  const base = originalFilename.replace(/\.[^.]*$/u, '').slice(0, 120) || 'image';
  return `${base}-${variant}.webp`;
}
