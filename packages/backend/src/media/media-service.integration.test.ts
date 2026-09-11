import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor, type SessionActor } from '../auth/index.js';
import { CatalogMediaOwnerAdapter } from '../catalog/media-owner-adapter.js';
import { ItemRepository } from '../catalog/item-repository.js';
import { migrateToLatest } from '../database.js';
import { TransactionalAuditPort, TransactionalOutboxPort } from '../infrastructure/index.js';
import { createSettingsClient } from '../settings.repository.js';
import { mediaLimits } from './media-policy.js';
import { MediaRepository } from './media-repository.js';
import { LocalMediaStorage } from './media-storage.js';
import { MediaService } from './media-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `media_${randomUUID().replaceAll('-', '')}`;
const instant = new Date('2026-09-11T12:00:00.000Z');
const maxUploadBytes = 4_096;

let adminPool: Pool;
let pool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let mediaRoot: string;
let storage: LocalMediaStorage;
let service: MediaService;
let now = instant;
let editor: SessionActor;
let admin: SessionActor;
let viewer: SessionActor;
let itemPublicId: string;
let itemId: string;

suite('MED-01 Item media uploads', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    const schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    pool = new Pool({ connectionString: schemaUrl, max: 2 });
    prisma = createSettingsClient(schemaUrl, 4);
    mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'atlas-media-it-'));
    storage = new LocalMediaStorage(mediaRoot);

    const editorId = randomUUID();
    const adminId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: editorId,
          emailNormalized: 'editor@example.test',
          displayName: 'Synthetic Editor',
          passwordHash: '$argon2id$synthetic',
          role: 'editor',
        },
        {
          id: adminId,
          emailNormalized: 'admin@example.test',
          displayName: 'Synthetic Admin',
          passwordHash: '$argon2id$synthetic',
          role: 'admin',
        },
      ],
    });
    editor = actorFor(editorId, 'editor');
    admin = actorFor(adminId, 'admin');
    viewer = { ...actorFor(editorId, 'viewer') };

    const categoryId = (
      await prisma.category.create({
        data: {
          id: randomUUID(),
          key: 'cameras',
          labelI18n: { en: 'Cameras' },
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    const lifecycleStatusId = (
      await prisma.lifecycleStatus.create({
        data: {
          id: randomUUID(),
          key: 'stored',
          labelI18n: { en: 'Stored' },
          colorToken: 'status.info',
          createdAt: instant,
          updatedAt: instant,
        },
      })
    ).id;
    itemId = randomUUID();
    itemPublicId = randomUUID();
    await prisma.item.create({
      data: {
        id: itemId,
        publicId: itemPublicId,
        slug: 'camera',
        categoryId,
        lifecycleStatusId,
        displayName: 'Camera',
        createdAt: instant,
        updatedAt: instant,
      },
    });

    service = new MediaService(
      new MediaRepository(prisma),
      storage,
      new CatalogMediaOwnerAdapter(new ItemRepository(prisma)),
      { audit: new TransactionalAuditPort(), outbox: new TransactionalOutboxPort() },
      maxUploadBytes,
      '/api/v1/media',
      randomUUID,
      () => now,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('commits the asset, relation, audit and processing message together', async () => {
    const bytes = jpeg(256);
    const attached = await attach(editor, 'front.jpg', bytes, { role: 'primary' });

    expect(attached).toMatchObject({
      role: 'primary',
      position: 0,
      originalFilename: 'front.jpg',
      mimeType: 'image/jpeg',
      byteSize: bytes.byteLength,
      processingState: 'pending',
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(attached.contentUrl).toBe(`/api/v1/media/assets/${attached.assetId}/content`);

    const asset = (
      await pool.query('select storage_key, delete_after from media_assets where id = $1', [
        attached.assetId,
      ])
    ).rows[0];
    expect(asset.delete_after).toBeNull();
    expect(await storage.exists(asset.storage_key)).toBe(true);
    expect(
      (await pool.query("select state from upload_sessions where state = 'finalized'")).rows,
    ).toHaveLength(1);
    expect(
      (await pool.query("select topic, payload_json from outbox where topic like 'media.%'")).rows,
    ).toContainEqual({
      topic: 'media.process-asset.v1',
      payload_json: { assetId: attached.assetId, mimeType: 'image/jpeg', payloadVersion: 1 },
    });
    expect(
      (await pool.query("select action from audit_events where action = 'media.attached'")).rows,
    ).toHaveLength(1);
  });

  it('keeps one active primary per Item and appends gallery images in order', async () => {
    const second = await attach(editor, 'second.jpg', jpeg(128), { role: 'primary' });
    const gallery = await attach(editor, 'third.jpg', jpeg(130), { role: 'gallery' });

    const media = await service.listItemMedia(editor, itemPublicId);
    const primary = media.filter((entry) => entry.role === 'primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.relationId).toBe(second.relationId);
    expect(
      Number(
        (
          await pool.query(
            `select count(*)::int as count from media_relations
               where item_id = $1 and role = 'primary' and archived_at is null`,
            [itemId],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    const positions = media
      .filter((entry) => entry.role === 'gallery')
      .map((entry) => entry.position);
    expect(positions).toEqual([...positions].toSorted((left, right) => left - right));
    expect(new Set(positions).size).toBe(positions.length);
    expect(media.map((entry) => entry.relationId)).toContain(gallery.relationId);
  });

  it('reorders the gallery only with the current Item version', async () => {
    const media = await service.listItemMedia(editor, itemPublicId);
    const gallery = media.filter((entry) => entry.role === 'gallery');
    expect(gallery.length).toBeGreaterThanOrEqual(2);
    const reversed = [...gallery].reverse().map((entry) => entry.relationId);

    await expect(service.reorderGallery(editor, itemPublicId, 99, reversed)).rejects.toMatchObject({
      code: 'MEDIA_OWNER_VERSION_CONFLICT',
      currentVersion: 1,
    });
    await expect(
      service.reorderGallery(editor, itemPublicId, 1, [gallery[0]!.relationId]),
    ).rejects.toMatchObject({ code: 'MEDIA_ORDER_INVALID' });

    const reordered = await service.reorderGallery(editor, itemPublicId, 1, reversed);
    const orderedIds = reordered
      .filter((entry) => entry.role === 'gallery')
      .map((entry) => entry.relationId);
    expect(orderedIds).toEqual(reversed);
    expect(
      reordered.filter((entry) => entry.role === 'gallery').map((entry) => entry.position),
    ).toEqual(reversed.map((_id, index) => index));
  });

  it('promotes a gallery image to primary and demotes the previous one', async () => {
    const before = await service.listItemMedia(editor, itemPublicId);
    const previousPrimary = before.find((entry) => entry.role === 'primary')!;
    const candidate = before.find((entry) => entry.role === 'gallery')!;

    const after = await service.setPrimary(editor, candidate.relationId, 1);

    expect(after.find((entry) => entry.role === 'primary')!.relationId).toBe(candidate.relationId);
    expect(after.find((entry) => entry.relationId === previousPrimary.relationId)!.role).toBe(
      'gallery',
    );
    expect(after.filter((entry) => entry.role === 'primary')).toHaveLength(1);
  });

  it('rejects an upload whose bytes contradict the declaration and leaves no asset', async () => {
    const assetsBefore = await countAssets();
    const session = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'fake.jpg',
      mimeType: 'image/jpeg',
      byteSize: 16,
    });
    await service.receiveContent(editor, session.sessionId, Readable.from([Buffer.alloc(16, 9)]));

    await expect(service.finalizeUpload(editor, session.sessionId, {})).rejects.toMatchObject({
      code: 'MEDIA_SIGNATURE_UNRECOGNIZED',
    });
    expect(await countAssets()).toBe(assetsBefore);
    expect(
      (
        await pool.query('select state, failure_code from upload_sessions where id = $1', [
          session.sessionId,
        ])
      ).rows[0],
    ).toEqual({ state: 'failed', failure_code: 'MEDIA_SIGNATURE_UNRECOGNIZED' });
    expect(await storage.exists(await temporaryKeyOf(session.sessionId))).toBe(false);
  });

  it('rejects a size or checksum mismatch and an oversized stream', async () => {
    const mismatched = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'short.jpg',
      mimeType: 'image/jpeg',
      byteSize: 999,
    });
    await service.receiveContent(editor, mismatched.sessionId, Readable.from([jpeg(64)]));
    await expect(service.finalizeUpload(editor, mismatched.sessionId, {})).rejects.toMatchObject({
      code: 'MEDIA_SIZE_MISMATCH',
    });

    const wrongChecksum = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'check.jpg',
      mimeType: 'image/jpeg',
      byteSize: 64,
    });
    await service.receiveContent(editor, wrongChecksum.sessionId, Readable.from([jpeg(64)]));
    await expect(
      service.finalizeUpload(editor, wrongChecksum.sessionId, { checksumSha256: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'MEDIA_CHECKSUM_MISMATCH' });

    const oversized = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'big.jpg',
      mimeType: 'image/jpeg',
      byteSize: maxUploadBytes,
    });
    await expect(
      service.receiveContent(
        editor,
        oversized.sessionId,
        Readable.from([jpeg(maxUploadBytes * 2)]),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_SIZE_EXCEEDED' });
    expect(await storage.exists(await temporaryKeyOf(oversized.sessionId))).toBe(false);
  });

  it('refuses a Viewer, an unknown Item and a foreign upload session', async () => {
    await expect(
      service.beginUpload(viewer, {
        itemPublicId,
        filename: 'nope.jpg',
        mimeType: 'image/jpeg',
        byteSize: 16,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_FORBIDDEN' });
    await expect(
      service.beginUpload(editor, {
        itemPublicId: randomUUID(),
        filename: 'nope.jpg',
        mimeType: 'image/jpeg',
        byteSize: 16,
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_OWNER_NOT_FOUND' });

    const session = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'mine.jpg',
      mimeType: 'image/jpeg',
      byteSize: 16,
    });
    await expect(
      service.receiveContent(admin, session.sessionId, Readable.from([jpeg(16)])),
    ).rejects.toMatchObject({ code: 'MEDIA_SESSION_NOT_FOUND' });
  });

  it('expires an abandoned session and reclaims its temporary object', async () => {
    const session = await service.beginUpload(editor, {
      itemPublicId,
      filename: 'stale.jpg',
      mimeType: 'image/jpeg',
      byteSize: 32,
    });
    await service.receiveContent(editor, session.sessionId, Readable.from([jpeg(32)]));
    const temporaryKey = await temporaryKeyOf(session.sessionId);
    expect(await storage.exists(temporaryKey)).toBe(true);

    now = new Date(instant.getTime() + mediaLimits.sessionTtlMs + 1_000);
    try {
      expect(await service.expireSessions()).toContain(session.sessionId);
      expect(await storage.exists(temporaryKey)).toBe(false);
      await expect(service.finalizeUpload(editor, session.sessionId, {})).rejects.toMatchObject({
        code: 'MEDIA_SESSION_EXPIRED',
      });
    } finally {
      now = instant;
    }
  });

  it('hides a private image from an actor without viewPrivateFields', async () => {
    const secret = await attach(admin, 'secret.jpg', jpeg(72), {
      role: 'gallery',
      visibility: 'private',
    });

    const editorView = await service.listItemMedia(editor, itemPublicId);
    expect(editorView.map((entry) => entry.relationId)).not.toContain(secret.relationId);
    expect((await service.listItemMedia(admin, itemPublicId)).map((e) => e.relationId)).toContain(
      secret.relationId,
    );
    await expect(service.openAssetContent(editor, secret.assetId)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
    const opened = await service.openAssetContent(admin, secret.assetId);
    expect(opened.asset.id).toBe(secret.assetId);
    opened.content.destroy();
  });

  it('schedules a detached asset and only deletes it once nothing references it', async () => {
    const detachable = await attach(editor, 'detach.jpg', jpeg(90), { role: 'gallery' });
    const storageKey = await storageKeyOf(detachable.assetId);

    await service.detachRelation(editor, detachable.relationId, 1);
    const scheduled = (
      await pool.query('select delete_after from media_assets where id = $1', [detachable.assetId])
    ).rows[0];
    expect(new Date(scheduled.delete_after).getTime()).toBe(
      instant.getTime() + mediaLimits.orphanGraceMs,
    );

    // Still inside the grace period: nothing is collected.
    expect(await service.collectOrphans()).toEqual({ deleted: [], retained: [] });
    expect(await storage.exists(storageKey)).toBe(true);

    now = new Date(instant.getTime() + mediaLimits.orphanGraceMs + 1_000);
    try {
      const collected = await service.collectOrphans();
      expect(collected.deleted).toContain(detachable.assetId);
      expect(await storage.exists(storageKey)).toBe(false);
      expect(
        Number(
          (
            await pool.query('select count(*)::int as count from media_assets where id = $1', [
              detachable.assetId,
            ])
          ).rows[0].count,
        ),
      ).toBe(0);
    } finally {
      now = instant;
    }
  });

  it('retains a due asset that gained a reference again before cleanup ran', async () => {
    const reattached = await attach(editor, 'keep.jpg', jpeg(95), { role: 'gallery' });
    const storageKey = await storageKeyOf(reattached.assetId);
    // A detach schedules deletion; a concurrent re-attachment restores the reference.
    await service.detachRelation(editor, reattached.relationId, 1);
    await pool.query(
      `insert into media_relations (id, asset_id, item_id, role, "position", visibility,
         created_at, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'gallery', 900, 'authenticated', $4, $4)`,
      [randomUUID(), reattached.assetId, itemId, instant],
    );

    now = new Date(instant.getTime() + mediaLimits.orphanGraceMs + 1_000);
    try {
      const collected = await service.collectOrphans();
      expect(collected.retained).toContain(reattached.assetId);
      expect(collected.deleted).not.toContain(reattached.assetId);
      expect(await storage.exists(storageKey)).toBe(true);
      expect(
        (
          await pool.query('select delete_after from media_assets where id = $1', [
            reattached.assetId,
          ])
        ).rows[0].delete_after,
      ).toBeNull();
    } finally {
      now = instant;
    }
  });
});

function actorFor(id: string, role: 'editor' | 'admin' | 'viewer'): SessionActor {
  return {
    id,
    email: `${role}@example.test`,
    displayName: `Synthetic ${role}`,
    locale: 'en',
    role,
    permissions: permissionsFor(role),
  };
}

/** A minimal but genuine JPEG header followed by filler, so signature checks see real bytes. */
function jpeg(byteSize: number): Buffer {
  const body = Buffer.alloc(Math.max(byteSize - 4, 0), 0x2a);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body]).subarray(0, byteSize);
}

async function attach(
  actor: SessionActor,
  filename: string,
  bytes: Buffer,
  input: { role?: string; visibility?: string } = {},
) {
  const session = await service.beginUpload(actor, {
    itemPublicId,
    filename,
    mimeType: 'image/jpeg',
    byteSize: bytes.byteLength,
  });
  await service.receiveContent(actor, session.sessionId, Readable.from([bytes]));
  return service.finalizeUpload(actor, session.sessionId, {
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    ...input,
  });
}

async function countAssets(): Promise<number> {
  return Number(
    (await pool.query('select count(*)::int as count from media_assets')).rows[0].count,
  );
}

async function temporaryKeyOf(sessionId: string): Promise<string> {
  return (
    await pool.query('select temp_storage_key from upload_sessions where id = $1', [sessionId])
  ).rows[0].temp_storage_key;
}

async function storageKeyOf(assetId: string): Promise<string> {
  return (await pool.query('select storage_key from media_assets where id = $1', [assetId])).rows[0]
    .storage_key;
}
