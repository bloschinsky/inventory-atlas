import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { can, type SessionActor } from '../auth/index.js';
import type { AuditPort, OutboxPort } from '../infrastructure/index.js';
import {
  fileExtension,
  mediaLimits,
  MediaPolicyError,
  normalizeAltText,
  normalizeUploadFilename,
  requireExtensionAgreement,
  validateDeclaredByteSize,
  validateMimeType,
  validateOrderedIds,
  validateRole,
  validateMediaVisibility,
  verifyReceivedUpload,
  type MediaRelationRole,
  type MediaVisibility,
} from './media-policy.js';
import {
  MediaRepository,
  type AttachedMedia,
  type MediaAssetRecord,
  type UploadSessionRecord,
} from './media-repository.js';
import {
  assetStorageKey,
  MediaStorageLimitError,
  temporaryUploadKey,
  type MediaStoragePort,
} from './media-storage.js';

/**
 * The Item facts the Media module needs. Catalog owns Items, so Media receives them through this
 * port instead of reading the `items` table itself.
 */
export interface MediaOwnerPort {
  resolveItem(publicId: string): Promise<MediaOwner | null>;
  resolveItemById(id: string): Promise<MediaOwner | null>;
}

export interface MediaOwner {
  id: string;
  publicId: string;
  version: number;
  visibility: 'public' | 'authenticated' | 'private' | 'unlisted';
  archivedAt: Date | null;
}

export type MediaAccessErrorCode =
  | 'MEDIA_FORBIDDEN'
  | 'MEDIA_OWNER_NOT_FOUND'
  | 'MEDIA_SESSION_NOT_FOUND'
  | 'MEDIA_SESSION_STATE_INVALID'
  | 'MEDIA_SESSION_EXPIRED'
  | 'MEDIA_RELATION_NOT_FOUND'
  | 'MEDIA_ASSET_NOT_FOUND';

export class MediaAccessError extends Error {
  constructor(
    readonly code: MediaAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaAccessError';
  }
}

/** Optimistic-concurrency rejection on the owning Item, mirroring the CAT-04 conflict shape. */
export class MediaVersionConflictError extends Error {
  readonly code = 'MEDIA_OWNER_VERSION_CONFLICT';

  constructor(readonly currentVersion: number) {
    super('The Item changed since the submitted version.');
    this.name = 'MediaVersionConflictError';
  }
}

export interface BeginUploadInput {
  itemPublicId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}

export interface UploadSessionView {
  sessionId: string;
  uploadUrl: string;
  declaredFilename: string;
  declaredMimeType: string;
  declaredByteSize: number;
  expiresAt: string;
  state: string;
}

export interface MediaView {
  relationId: string;
  assetId: string;
  role: MediaRelationRole;
  position: number;
  altText: string | null;
  visibility: MediaVisibility;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  processingState: string;
  contentUrl: string;
}

export interface MediaRequestMetadata {
  correlationId?: string;
  requestId?: string;
}

interface MediaServicePorts {
  audit: AuditPort;
  outbox: OutboxPort;
}

/**
 * Media application surface (blueprint section 12.1). An upload is a three-step flow: an
 * authorized session declares the file, the content request streams the bytes into temporary
 * storage while the checksum is computed, and finalize verifies size, checksum and file
 * signature before the asset row, its relation and the promoted object exist together.
 */
export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: MediaStoragePort,
    private readonly owners: MediaOwnerPort,
    private readonly ports: MediaServicePorts,
    private readonly maxUploadBytes: number,
    private readonly publicBasePath = '/api/v1/media',
    private readonly newId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async beginUpload(actor: SessionActor, input: BeginUploadInput): Promise<UploadSessionView> {
    const owner = await this.requireEditableOwner(actor, input.itemPublicId);
    const filename = normalizeUploadFilename(input.filename);
    const mimeType = validateMimeType(input.mimeType);
    requireExtensionAgreement(filename, mimeType);
    const byteSize = validateDeclaredByteSize(input.byteSize, this.maxUploadBytes);
    const now = this.now();
    const session = await this.repository.createSession({
      actorId: actor.id,
      itemId: owner.id,
      declaredFilename: filename,
      declaredMimeType: mimeType,
      declaredByteSize: byteSize,
      tempStorageKey: temporaryUploadKey(this.newId()),
      expiresAt: new Date(now.getTime() + mediaLimits.sessionTtlMs),
      now,
    });
    return this.sessionView(session);
  }

  /**
   * Streams the upload into temporary storage. The byte ceiling is enforced while writing, so an
   * oversized upload never lands on disk in full, and the session records what was received.
   */
  async receiveContent(
    actor: SessionActor,
    sessionId: string,
    content: Readable,
  ): Promise<UploadSessionView> {
    const session = await this.requireOwnSession(actor, sessionId, ['pending']);
    let stored;
    try {
      stored = await this.storage.writeTemp(session.tempStorageKey, content, this.maxUploadBytes);
    } catch (error) {
      await this.failSession(
        session,
        error instanceof MediaStorageLimitError ? 'MEDIA_SIZE_EXCEEDED' : 'MEDIA_UPLOAD_FAILED',
      );
      if (error instanceof MediaStorageLimitError)
        throw new MediaPolicyError('MEDIA_SIZE_EXCEEDED', 'content', error.message);
      throw error;
    }
    const received = await this.repository.advanceSession(session.id, ['pending'], 'received', {
      receivedByteSize: stored.byteSize,
      checksumSha256: stored.checksumSha256,
      now: this.now(),
    });
    if (!received) {
      await this.storage.remove(session.tempStorageKey);
      throw new MediaAccessError(
        'MEDIA_SESSION_STATE_INVALID',
        'The upload session is no longer open.',
      );
    }
    return this.sessionView(received);
  }

  /**
   * Verifies the received bytes and commits the asset, its relation and the session completion
   * in one Prisma transaction. The object is promoted first and removed again if the transaction
   * fails, so storage never holds an object no row references.
   */
  async finalizeUpload(
    actor: SessionActor,
    sessionId: string,
    input: {
      checksumSha256?: string | null;
      role?: string;
      altText?: string | null;
      visibility?: string;
    },
    metadata: MediaRequestMetadata = {},
  ): Promise<MediaView> {
    const session = await this.requireOwnSession(actor, sessionId, ['received']);
    if (!session.itemId)
      throw new MediaAccessError('MEDIA_OWNER_NOT_FOUND', 'The upload has no Item owner.');
    const role = validateRole(input.role);
    const altText = normalizeAltText(input.altText);
    const visibility = validateMediaVisibility(input.visibility);
    const head = await this.readSignature(session);
    try {
      verifyReceivedUpload({
        declaredByteSize: session.declaredByteSize,
        declaredMimeType: session.declaredMimeType,
        receivedByteSize: session.receivedByteSize ?? -1,
        checksumSha256: session.checksumSha256 ?? '',
        expectedChecksum: input.checksumSha256 ?? null,
        head,
        maxUploadBytes: this.maxUploadBytes,
      });
    } catch (error) {
      await this.failSession(
        session,
        error instanceof MediaPolicyError ? error.code : 'MEDIA_UPLOAD_FAILED',
      );
      throw error;
    }

    const assetId = this.newId();
    const storageKey = assetStorageKey(assetId, fileExtension(session.declaredFilename));
    const now = this.now();
    await this.storage.promote(session.tempStorageKey, storageKey);
    try {
      const attached = await this.repository.transaction(async (transaction) => {
        const context = { kind: 'prisma' as const, trx: transaction };
        const asset = await this.repository.createAsset(transaction, {
          id: assetId,
          storageKey,
          originalFilename: session.declaredFilename,
          mimeType: session.declaredMimeType,
          byteSize: session.receivedByteSize!,
          checksumSha256: session.checksumSha256!,
          now,
        });
        const position =
          role === 'gallery'
            ? await this.repository.nextGalleryPosition(transaction, session.itemId!)
            : 0;
        if (role === 'primary') {
          // Exactly one active primary per owner: the previous one becomes a gallery image.
          const demotedPosition = await this.repository.nextGalleryPosition(
            transaction,
            session.itemId!,
          );
          await this.repository.demotePrimary(transaction, session.itemId!, demotedPosition, now);
        }
        const relation = await this.repository.createRelation(transaction, {
          assetId: asset.id,
          itemId: session.itemId!,
          role,
          position,
          altText,
          visibility,
          now,
        });
        const completed = await this.repository.advanceSession(
          session.id,
          ['received'],
          'finalized',
          { finalizedAt: now, now },
          transaction,
        );
        if (!completed)
          throw new MediaAccessError(
            'MEDIA_SESSION_STATE_INVALID',
            'The upload session is no longer open.',
          );
        await this.ports.audit.record(context, {
          actorId: actor.id,
          action: 'media.attached',
          entityType: 'media_relation',
          entityId: relation.id,
          ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
          ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
          before: null,
          after: {
            assetId: asset.id,
            itemId: session.itemId,
            role,
            visibility,
            byteSize: asset.byteSize,
            mimeType: asset.mimeType,
          },
          createdAt: now,
        });
        // MED-02 consumes this message to decode, strip metadata and build variants.
        await this.ports.outbox.enqueue(context, {
          topic: 'media.process-asset.v1',
          aggregateType: 'media_asset',
          aggregateId: asset.id,
          payload: { assetId: asset.id, mimeType: asset.mimeType, payloadVersion: 1 },
          deduplicationKey: `media-process:${asset.id}`,
          createdAt: now,
        });
        return { relation, asset };
      });
      return this.mediaView(attached);
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  async listItemMedia(actor: SessionActor, itemPublicId: string): Promise<MediaView[]> {
    const owner = await this.requireReadableOwner(actor, itemPublicId);
    const privileged = can(actor.role, 'viewPrivateFields');
    const attached = await this.repository.listItemMedia(owner.id);
    return attached
      .filter((entry) => privileged || entry.relation.visibility !== 'private')
      .map((entry) => this.mediaView(entry));
  }

  /**
   * Rewrites gallery positions as one contiguous run. The caller states the Item version it saw,
   * so a reorder built on a stale gallery is rejected instead of shuffling somebody else's list.
   */
  async reorderGallery(
    actor: SessionActor,
    itemPublicId: string,
    expectedVersion: number,
    orderedRelationIds: readonly string[],
    metadata: MediaRequestMetadata = {},
  ): Promise<MediaView[]> {
    const owner = await this.requireEditableOwner(actor, itemPublicId);
    if (owner.version !== expectedVersion) throw new MediaVersionConflictError(owner.version);
    const now = this.now();
    await this.repository.transaction(async (transaction) => {
      const active = await this.repository.listItemMedia(owner.id, transaction);
      const gallery = active.filter((entry) => entry.relation.role === 'gallery');
      const ordered = validateOrderedIds(
        orderedRelationIds,
        new Set(gallery.map((entry) => entry.relation.id)),
      );
      // Two passes keep the (owner, role, position) unique index satisfied mid-transaction.
      const parking = gallery.length + 1_000;
      for (const [index, entry] of gallery.entries())
        await this.repository.setRelationPosition(
          transaction,
          entry.relation.id,
          parking + index,
          now,
        );
      for (const [index, relationId] of ordered.entries())
        await this.repository.setRelationPosition(transaction, relationId, index, now);
      await this.ports.audit.record(
        { kind: 'prisma', trx: transaction },
        {
          actorId: actor.id,
          action: 'media.reordered',
          entityType: 'item',
          entityId: owner.id,
          ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
          ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
          before: null,
          after: { itemId: owner.id, order: [...ordered] },
          createdAt: now,
        },
      );
    });
    return this.listItemMedia(actor, itemPublicId);
  }

  /** Promotes one relation to primary and demotes the previous primary to the gallery. */
  async setPrimary(
    actor: SessionActor,
    relationId: string,
    expectedVersion: number,
    metadata: MediaRequestMetadata = {},
  ): Promise<MediaView[]> {
    const attached = await this.repository.findRelation(relationId);
    if (!attached || attached.relation.archivedAt || !attached.relation.itemId)
      throw new MediaAccessError('MEDIA_RELATION_NOT_FOUND', 'The media relation does not exist.');
    const owner = await this.requireEditableOwnerById(actor, attached.relation.itemId);
    if (owner.version !== expectedVersion) throw new MediaVersionConflictError(owner.version);
    const now = this.now();
    if (attached.relation.role !== 'primary') {
      await this.repository.transaction(async (transaction) => {
        const promotedFrom = attached.relation.position;
        // Park the promoted row first so the demoted primary can take a free gallery position.
        await this.repository.setRelationPosition(
          transaction,
          attached.relation.id,
          promotedFrom + 1_000,
          now,
        );
        await this.repository.demotePrimary(transaction, owner.id, promotedFrom, now);
        await this.repository.setRelationRole(transaction, attached.relation.id, 'primary', 0, now);
        await this.ports.audit.record(
          { kind: 'prisma', trx: transaction },
          {
            actorId: actor.id,
            action: 'media.primary-changed',
            entityType: 'item',
            entityId: owner.id,
            ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
            ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
            before: null,
            after: { itemId: owner.id, relationId: attached.relation.id },
            createdAt: now,
          },
        );
      });
    }
    return this.listItemMedia(actor, owner.publicId);
  }

  /**
   * Detaches media from its owner. The asset itself is only scheduled for deletion, so a mistaken
   * detach can be undone and a shared asset is never removed while another owner references it.
   */
  async detachRelation(
    actor: SessionActor,
    relationId: string,
    expectedVersion: number,
    metadata: MediaRequestMetadata = {},
  ): Promise<void> {
    const attached = await this.repository.findRelation(relationId);
    if (!attached || attached.relation.archivedAt || !attached.relation.itemId)
      throw new MediaAccessError('MEDIA_RELATION_NOT_FOUND', 'The media relation does not exist.');
    const owner = await this.requireEditableOwnerById(actor, attached.relation.itemId);
    if (owner.version !== expectedVersion) throw new MediaVersionConflictError(owner.version);
    const now = this.now();
    const deleteAfter = new Date(now.getTime() + mediaLimits.orphanGraceMs);
    await this.repository.transaction(async (transaction) => {
      const archived = await this.repository.archiveRelation(
        transaction,
        attached.relation.id,
        attached.asset.id,
        now,
        deleteAfter,
      );
      if (!archived)
        throw new MediaAccessError(
          'MEDIA_RELATION_NOT_FOUND',
          'The media relation does not exist.',
        );
      await this.ports.audit.record(
        { kind: 'prisma', trx: transaction },
        {
          actorId: actor.id,
          action: 'media.detached',
          entityType: 'media_relation',
          entityId: attached.relation.id,
          ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
          ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
          before: { itemId: owner.id, role: attached.relation.role },
          after: { deleteAfter: deleteAfter.toISOString() },
          createdAt: now,
        },
      );
    });
  }

  /** Streams the stored bytes of one asset to a caller allowed to see the owning relation. */
  async openAssetContent(
    actor: SessionActor,
    assetId: string,
  ): Promise<{ asset: MediaAssetRecord; content: Readable }> {
    const attached = (await this.repository.findRelationsByAsset(assetId)).filter(
      (entry) => !entry.relation.archivedAt,
    );
    const privileged = can(actor.role, 'viewPrivateFields');
    const visible = attached.filter(
      (entry) => privileged || entry.relation.visibility !== 'private',
    );
    if (!visible.length)
      throw new MediaAccessError('MEDIA_ASSET_NOT_FOUND', 'The media asset does not exist.');
    const asset = visible[0]!.asset;
    return { asset, content: await this.storage.openRead(asset.storageKey) };
  }

  /**
   * Delayed orphan cleanup. Every candidate is rechecked against live references immediately
   * before deletion, and the delete itself is conditional, so an asset that was re-attached in
   * the meantime is retained instead of removed.
   */
  async collectOrphans(limit = 100): Promise<{ deleted: string[]; retained: string[] }> {
    const now = this.now();
    const deleted: string[] = [];
    const retained: string[] = [];
    for (const asset of await this.repository.dueAssets(now, limit)) {
      if ((await this.repository.countActiveRelations(asset.id)) > 0) {
        await this.repository.retainAsset(asset.id, now);
        retained.push(asset.id);
        continue;
      }
      if (!(await this.repository.deleteAssetIfUnreferenced(asset.id, now))) {
        retained.push(asset.id);
        continue;
      }
      await this.storage.remove(asset.storageKey);
      deleted.push(asset.id);
    }
    return { deleted, retained };
  }

  /** Reclaims the temporary object of every session whose lease has passed. */
  async expireSessions(): Promise<string[]> {
    const expired = await this.repository.expireSessions(this.now());
    for (const session of expired) await this.storage.remove(session.tempStorageKey);
    return expired.map((session) => session.id);
  }

  private async requireEditableOwner(actor: SessionActor, publicId: string): Promise<MediaOwner> {
    if (!can(actor.role, 'editItems'))
      throw new MediaAccessError('MEDIA_FORBIDDEN', 'The actor cannot manage Item media.');
    const owner = await this.owners.resolveItem(publicId);
    if (!owner || owner.archivedAt)
      throw new MediaAccessError('MEDIA_OWNER_NOT_FOUND', 'The Item does not exist.');
    return owner;
  }

  private async requireEditableOwnerById(actor: SessionActor, itemId: string): Promise<MediaOwner> {
    if (!can(actor.role, 'editItems'))
      throw new MediaAccessError('MEDIA_FORBIDDEN', 'The actor cannot manage Item media.');
    const owner = await this.owners.resolveItemById(itemId);
    if (!owner || owner.archivedAt)
      throw new MediaAccessError('MEDIA_OWNER_NOT_FOUND', 'The Item does not exist.');
    return owner;
  }

  private async requireReadableOwner(actor: SessionActor, publicId: string): Promise<MediaOwner> {
    if (!can(actor.role, 'viewPublicCards'))
      throw new MediaAccessError('MEDIA_OWNER_NOT_FOUND', 'The Item does not exist.');
    const owner = await this.owners.resolveItem(publicId);
    const privileged = can(actor.role, 'viewPrivateFields');
    if (!owner || owner.archivedAt || (owner.visibility === 'private' && !privileged))
      throw new MediaAccessError('MEDIA_OWNER_NOT_FOUND', 'The Item does not exist.');
    return owner;
  }

  private async requireOwnSession(
    actor: SessionActor,
    sessionId: string,
    states: readonly UploadSessionRecord['state'][],
  ): Promise<UploadSessionRecord> {
    const session = await this.repository.findSession(sessionId);
    if (!session || session.actorId !== actor.id)
      throw new MediaAccessError('MEDIA_SESSION_NOT_FOUND', 'The upload session does not exist.');
    if (session.expiresAt.getTime() <= this.now().getTime()) {
      await this.failSession(session, 'MEDIA_SESSION_EXPIRED', 'expired');
      throw new MediaAccessError('MEDIA_SESSION_EXPIRED', 'The upload session expired.');
    }
    if (!states.includes(session.state))
      throw new MediaAccessError(
        'MEDIA_SESSION_STATE_INVALID',
        'The upload session is not in the required state.',
      );
    return session;
  }

  private async failSession(
    session: UploadSessionRecord,
    failureCode: string,
    state: 'failed' | 'expired' = 'failed',
  ): Promise<void> {
    await this.repository.advanceSession(session.id, ['pending', 'received'], state, {
      failureCode,
      now: this.now(),
    });
    await this.storage.remove(session.tempStorageKey);
  }

  private async readSignature(session: UploadSessionRecord): Promise<Uint8Array> {
    const content = await this.storage.openRead(session.tempStorageKey);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of content) {
      const buffer = Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.byteLength;
      if (length >= mediaLimits.signatureBytes) break;
    }
    content.destroy();
    return Buffer.concat(chunks).subarray(0, mediaLimits.signatureBytes);
  }

  private sessionView(session: UploadSessionRecord): UploadSessionView {
    return {
      sessionId: session.id,
      uploadUrl: `${this.publicBasePath}/upload-sessions/${session.id}/content`,
      declaredFilename: session.declaredFilename,
      declaredMimeType: session.declaredMimeType,
      declaredByteSize: session.declaredByteSize,
      expiresAt: session.expiresAt.toISOString(),
      state: session.state,
    };
  }

  private mediaView(entry: AttachedMedia): MediaView {
    return {
      relationId: entry.relation.id,
      assetId: entry.asset.id,
      role: entry.relation.role,
      position: entry.relation.position,
      altText: entry.relation.altText,
      visibility: entry.relation.visibility,
      originalFilename: entry.asset.originalFilename,
      mimeType: entry.asset.mimeType,
      byteSize: entry.asset.byteSize,
      width: entry.asset.width,
      height: entry.asset.height,
      checksumSha256: entry.asset.checksumSha256,
      processingState: entry.asset.processingState,
      contentUrl: `${this.publicBasePath}/assets/${entry.asset.id}/content`,
    };
  }
}
