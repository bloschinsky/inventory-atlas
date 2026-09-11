import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { ApprovedImageMimeType, MediaRelationRole, MediaVisibility } from './media-policy.js';

type MediaClient = Pick<
  PrismaClient,
  'mediaAsset' | 'mediaRelation' | 'uploadSession' | '$transaction'
>;
export type MediaTransaction = Prisma.TransactionClient;

export type UploadSessionState = 'pending' | 'received' | 'finalized' | 'failed' | 'expired';

export interface UploadSessionRecord {
  id: string;
  actorId: string;
  itemId: string | null;
  storageNodeId: string | null;
  declaredFilename: string;
  declaredMimeType: ApprovedImageMimeType;
  declaredByteSize: number;
  tempStorageKey: string;
  receivedByteSize: number | null;
  checksumSha256: string | null;
  state: UploadSessionState;
  failureCode: string | null;
  expiresAt: Date;
  createdAt: Date;
  finalizedAt: Date | null;
}

export interface MediaAssetRecord {
  id: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  processingState: 'pending' | 'ready' | 'failed';
  sourceAssetId: string | null;
  deleteAfter: Date | null;
  createdAt: Date;
}

/** A derived image produced by MED-02. The variant name lives in the technical metadata. */
export interface MediaVariantRecord {
  id: string;
  name: string;
  sourceAssetId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
}

export interface MediaVariantInput {
  name: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  checksumSha256: string;
  originalFilename: string;
}

export interface MediaRelationRecord {
  id: string;
  assetId: string;
  itemId: string | null;
  storageNodeId: string | null;
  role: MediaRelationRole;
  position: number;
  altText: string | null;
  visibility: MediaVisibility;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface AttachedMedia {
  relation: MediaRelationRecord;
  asset: MediaAssetRecord;
}

/**
 * Prisma-owned Media persistence. Every multi-row change runs inside one Prisma transaction so
 * an asset, its relation and the session state can never disagree.
 */
export class MediaRepository {
  constructor(
    private readonly prisma: MediaClient,
    private readonly newId: () => string = randomUUID,
  ) {}

  transaction<T>(work: (transaction: MediaTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  async createSession(input: {
    actorId: string;
    itemId: string;
    declaredFilename: string;
    declaredMimeType: ApprovedImageMimeType;
    declaredByteSize: number;
    tempStorageKey: string;
    expiresAt: Date;
    now: Date;
  }): Promise<UploadSessionRecord> {
    const row = await this.prisma.uploadSession.create({
      data: {
        id: this.newId(),
        actorId: input.actorId,
        itemId: input.itemId,
        declaredFilename: input.declaredFilename,
        declaredMimeType: input.declaredMimeType,
        declaredByteSize: BigInt(input.declaredByteSize),
        tempStorageKey: input.tempStorageKey,
        state: 'pending',
        expiresAt: input.expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toSessionRecord(row);
  }

  async findSession(
    id: string,
    transaction?: MediaTransaction,
  ): Promise<UploadSessionRecord | null> {
    const row = await (transaction ?? this.prisma).uploadSession.findUnique({ where: { id } });
    return row ? toSessionRecord(row) : null;
  }

  /**
   * Moves a session between states with the expected current state as a guard, so two concurrent
   * content or finalize requests cannot both progress the same session.
   */
  async advanceSession(
    id: string,
    from: readonly UploadSessionState[],
    to: UploadSessionState,
    change: {
      receivedByteSize?: number;
      checksumSha256?: string;
      failureCode?: string | null;
      finalizedAt?: Date | null;
      now: Date;
    },
    transaction?: MediaTransaction,
  ): Promise<UploadSessionRecord | null> {
    const client = transaction ?? this.prisma;
    const [row] = await client.uploadSession.updateManyAndReturn({
      where: { id, state: { in: [...from] } },
      data: {
        state: to,
        updatedAt: change.now,
        ...(change.receivedByteSize === undefined
          ? {}
          : { receivedByteSize: BigInt(change.receivedByteSize) }),
        ...(change.checksumSha256 === undefined ? {} : { checksumSha256: change.checksumSha256 }),
        ...(change.failureCode === undefined ? {} : { failureCode: change.failureCode }),
        finalizedAt: to === 'finalized' ? (change.finalizedAt ?? change.now) : null,
      },
    });
    return row ? toSessionRecord(row) : null;
  }

  /** Marks every open session whose lease has passed, so its temporary object can be reclaimed. */
  async expireSessions(now: Date): Promise<UploadSessionRecord[]> {
    const rows = await this.prisma.uploadSession.updateManyAndReturn({
      where: { state: { in: ['pending', 'received'] }, expiresAt: { lt: now } },
      data: { state: 'expired', updatedAt: now, failureCode: 'MEDIA_SESSION_EXPIRED' },
    });
    return rows.map(toSessionRecord);
  }

  async createAsset(
    transaction: MediaTransaction,
    input: {
      id: string;
      storageKey: string;
      originalFilename: string;
      mimeType: string;
      byteSize: number;
      checksumSha256: string;
      now: Date;
    },
  ): Promise<MediaAssetRecord> {
    const row = await transaction.mediaAsset.create({
      data: {
        id: input.id,
        storageKey: input.storageKey,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: BigInt(input.byteSize),
        checksumSha256: input.checksumSha256,
        // MED-02 decodes the image and moves the asset to `ready`.
        processingState: 'pending',
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toAssetRecord(row);
  }

  async createRelation(
    transaction: MediaTransaction,
    input: {
      assetId: string;
      itemId: string;
      role: MediaRelationRole;
      position: number;
      altText: string | null;
      visibility: MediaVisibility;
      now: Date;
    },
  ): Promise<MediaRelationRecord> {
    const row = await transaction.mediaRelation.create({
      data: {
        id: this.newId(),
        assetId: input.assetId,
        itemId: input.itemId,
        role: input.role,
        position: input.position,
        altText: input.altText,
        visibility: input.visibility,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRelationRecord(row);
  }

  async findAsset(id: string, transaction?: MediaTransaction): Promise<MediaAssetRecord | null> {
    const row = await (transaction ?? this.prisma).mediaAsset.findUnique({ where: { id } });
    return row ? toAssetRecord(row) : null;
  }

  /** The derived images of one source asset, ordered so the smallest is first. */
  async listVariants(
    sourceAssetId: string,
    transaction?: MediaTransaction,
  ): Promise<MediaVariantRecord[]> {
    const rows = await (transaction ?? this.prisma).mediaAsset.findMany({
      where: { sourceAssetId },
      orderBy: [{ byteSize: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toVariantRecord);
  }

  /** Variants of several sources at once, so a media listing needs one query, not one per asset. */
  async listVariantsForAssets(
    sourceAssetIds: readonly string[],
    transaction?: MediaTransaction,
  ): Promise<MediaVariantRecord[]> {
    if (!sourceAssetIds.length) return [];
    const rows = await (transaction ?? this.prisma).mediaAsset.findMany({
      where: { sourceAssetId: { in: [...sourceAssetIds] } },
      orderBy: [{ byteSize: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toVariantRecord);
  }

  /**
   * Rewrites the variant set of one source asset. Reprocessing is therefore idempotent: the
   * previous rows are removed in the same transaction that inserts the new ones, and the storage
   * keys are deterministic, so no orphan object survives a second attempt.
   */
  async replaceVariants(
    transaction: MediaTransaction,
    sourceAssetId: string,
    variants: readonly MediaVariantInput[],
    now: Date,
  ): Promise<MediaVariantRecord[]> {
    await transaction.mediaAsset.deleteMany({ where: { sourceAssetId } });
    const created: MediaVariantRecord[] = [];
    for (const variant of variants) {
      const row = await transaction.mediaAsset.create({
        data: {
          id: this.newId(),
          sourceAssetId,
          storageKey: variant.storageKey,
          originalFilename: variant.originalFilename,
          mimeType: variant.mimeType,
          byteSize: BigInt(variant.byteSize),
          width: variant.width,
          height: variant.height,
          checksumSha256: variant.checksumSha256,
          processingState: 'ready',
          metadataJson: { variant: variant.name },
          createdAt: now,
          updatedAt: now,
        },
      });
      created.push(toVariantRecord(row));
    }
    return created;
  }

  /** Records the decoded dimensions and technical metadata and publishes the asset. */
  async markAssetProcessed(
    transaction: MediaTransaction,
    id: string,
    input: { width: number; height: number; metadata: Record<string, unknown>; now: Date },
  ): Promise<void> {
    await transaction.mediaAsset.update({
      where: { id },
      data: {
        width: input.width,
        height: input.height,
        processingState: 'ready',
        metadataJson: input.metadata as never,
        updatedAt: input.now,
      },
    });
  }

  /**
   * Marks an asset that can never be processed. Only the stable failure code is stored; decoder
   * output may quote image content and never reaches a row.
   */
  async markAssetFailed(id: string, failureCode: string, now: Date): Promise<void> {
    await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        processingState: 'failed',
        metadataJson: { failureCode, failedAt: now.toISOString() },
        updatedAt: now,
      },
    });
  }

  async listItemMedia(itemId: string, transaction?: MediaTransaction): Promise<AttachedMedia[]> {
    const rows = await (transaction ?? this.prisma).mediaRelation.findMany({
      where: { itemId, archivedAt: null },
      include: { asset: true },
      orderBy: [{ role: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      relation: toRelationRecord(row),
      asset: toAssetRecord(row.asset),
    }));
  }

  async findRelation(id: string, transaction?: MediaTransaction): Promise<AttachedMedia | null> {
    const row = await (transaction ?? this.prisma).mediaRelation.findUnique({
      where: { id },
      include: { asset: true },
    });
    return row ? { relation: toRelationRecord(row), asset: toAssetRecord(row.asset) } : null;
  }

  async findRelationsByAsset(
    assetId: string,
    transaction?: MediaTransaction,
  ): Promise<AttachedMedia[]> {
    const rows = await (transaction ?? this.prisma).mediaRelation.findMany({
      where: { assetId },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      relation: toRelationRecord(row),
      asset: toAssetRecord(row.asset),
    }));
  }

  /** Demotes the current primary of an owner so a new primary can take the role. */
  async demotePrimary(
    transaction: MediaTransaction,
    itemId: string,
    position: number,
    now: Date,
  ): Promise<MediaRelationRecord | null> {
    const [row] = await transaction.mediaRelation.updateManyAndReturn({
      where: { itemId, role: 'primary', archivedAt: null },
      data: { role: 'gallery', position, updatedAt: now },
    });
    return row ? toRelationRecord(row) : null;
  }

  async setRelationPosition(
    transaction: MediaTransaction,
    id: string,
    position: number,
    now: Date,
  ): Promise<void> {
    await transaction.mediaRelation.update({
      where: { id },
      data: { position, updatedAt: now },
    });
  }

  async setRelationRole(
    transaction: MediaTransaction,
    id: string,
    role: MediaRelationRole,
    position: number,
    now: Date,
  ): Promise<void> {
    await transaction.mediaRelation.update({
      where: { id },
      data: { role, position, updatedAt: now },
    });
  }

  /** Archives a relation and schedules the asset for delayed cleanup. */
  async archiveRelation(
    transaction: MediaTransaction,
    id: string,
    assetId: string,
    now: Date,
    deleteAfter: Date,
  ): Promise<MediaRelationRecord | null> {
    const [row] = await transaction.mediaRelation.updateManyAndReturn({
      where: { id, archivedAt: null },
      data: { archivedAt: now, updatedAt: now },
    });
    if (!row) return null;
    await transaction.mediaAsset.update({
      where: { id: assetId },
      data: { deleteAfter, updatedAt: now },
    });
    return toRelationRecord(row);
  }

  async nextGalleryPosition(transaction: MediaTransaction, itemId: string): Promise<number> {
    const highest = await transaction.mediaRelation.findFirst({
      where: { itemId, role: 'gallery', archivedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return highest ? highest.position + 1 : 0;
  }

  /** Assets whose grace period has passed and are therefore cleanup candidates. */
  async dueAssets(now: Date, limit = 100): Promise<MediaAssetRecord[]> {
    const rows = await this.prisma.mediaAsset.findMany({
      // Variants are reclaimed with their source, never scheduled on their own.
      where: { deleteAfter: { lte: now }, sourceAssetId: null },
      orderBy: { deleteAfter: 'asc' },
      take: limit,
    });
    return rows.map(toAssetRecord);
  }

  async countActiveRelations(assetId: string, transaction?: MediaTransaction): Promise<number> {
    return (transaction ?? this.prisma).mediaRelation.count({
      where: { assetId, archivedAt: null },
    });
  }

  /** Clears the deletion schedule of an asset that gained a reference again. */
  async retainAsset(id: string, now: Date): Promise<void> {
    await this.prisma.mediaAsset.update({
      where: { id },
      data: { deleteAfter: null, updatedAt: now },
    });
  }

  /**
   * Deletes an asset row only while no active relation references it and it is still due, so a
   * concurrent re-attachment between the recheck and the delete cannot lose a referenced asset.
   * Archived relations cascade away with the asset; the detach audit event keeps the history.
   */
  async deleteAssetIfUnreferenced(id: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const references = await transaction.mediaRelation.count({
        where: { assetId: id, archivedAt: null },
      });
      if (references > 0) return false;
      const removed = await transaction.mediaAsset.deleteMany({
        where: { id, deleteAfter: { lte: now } },
      });
      return removed.count === 1;
    });
  }
}

function toSessionRecord(row: {
  id: string;
  actorId: string;
  itemId: string | null;
  storageNodeId: string | null;
  declaredFilename: string;
  declaredMimeType: string;
  declaredByteSize: bigint;
  tempStorageKey: string;
  receivedByteSize: bigint | null;
  checksumSha256: string | null;
  state: string;
  failureCode: string | null;
  expiresAt: Date;
  createdAt: Date;
  finalizedAt: Date | null;
}): UploadSessionRecord {
  return {
    ...row,
    declaredMimeType: row.declaredMimeType as ApprovedImageMimeType,
    declaredByteSize: Number(row.declaredByteSize),
    receivedByteSize: row.receivedByteSize === null ? null : Number(row.receivedByteSize),
    state: row.state as UploadSessionState,
  };
}

function toAssetRecord(row: {
  id: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: bigint;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  processingState: string;
  sourceAssetId: string | null;
  deleteAfter: Date | null;
  createdAt: Date;
}): MediaAssetRecord {
  return {
    id: row.id,
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    width: row.width,
    height: row.height,
    checksumSha256: row.checksumSha256,
    processingState: row.processingState as MediaAssetRecord['processingState'],
    sourceAssetId: row.sourceAssetId,
    deleteAfter: row.deleteAfter,
    createdAt: row.createdAt,
  };
}

function toVariantRecord(row: {
  id: string;
  storageKey: string;
  mimeType: string;
  byteSize: bigint;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  sourceAssetId: string | null;
  metadataJson: unknown;
}): MediaVariantRecord {
  const metadata = (row.metadataJson ?? {}) as { variant?: unknown };
  return {
    id: row.id,
    name: typeof metadata.variant === 'string' ? metadata.variant : 'variant',
    sourceAssetId: row.sourceAssetId!,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: Number(row.byteSize),
    width: row.width,
    height: row.height,
    checksumSha256: row.checksumSha256,
  };
}

function toRelationRecord(row: {
  id: string;
  assetId: string;
  itemId: string | null;
  storageNodeId: string | null;
  role: string;
  position: number;
  altText: string | null;
  visibility: string;
  createdAt: Date;
  archivedAt: Date | null;
}): MediaRelationRecord {
  return {
    ...row,
    role: row.role as MediaRelationRole,
    visibility: row.visibility as MediaVisibility,
  };
}
