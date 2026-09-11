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
  deleteAfter: Date | null;
  createdAt: Date;
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
      where: { deleteAfter: { lte: now } },
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
  deleteAfter: Date | null;
  createdAt: Date;
}): MediaAssetRecord {
  return {
    ...row,
    byteSize: Number(row.byteSize),
    processingState: row.processingState as MediaAssetRecord['processingState'],
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
