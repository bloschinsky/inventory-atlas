import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionsFor, type SessionActor } from '../auth/index.js';
import { CatalogMediaOwnerAdapter } from '../catalog/media-owner-adapter.js';
import { ItemRepository } from '../catalog/item-repository.js';
import { createDatabase, migrateToLatest, type FoundationDatabase } from '../database.js';
import { TransactionalAuditPort, TransactionalOutboxPort } from '../infrastructure/index.js';
import { JobRepository, JobRunner, OutboxDispatcher, type JobHandler } from '../jobs/index.js';
import { createSettingsClient } from '../settings.repository.js';
import { mediaCapabilityFixtures } from './capability-fixtures.js';
import { ChildImageProcessor } from './image-processor.js';
import { variantStorageKey } from './image-variants.js';
import { MediaProcessingService } from './media-processing-service.js';
import { MediaRepository } from './media-repository.js';
import { LocalMediaStorage } from './media-storage.js';
import { MediaService } from './media-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `media_processing_${randomUUID().replaceAll('-', '')}`;
const instant = new Date('2026-09-11T12:00:00.000Z');
const maxUploadBytes = 1_048_576;

let adminPool: Pool;
let pool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let database: ReturnType<typeof createDatabase>;
let mediaRoot: string;
let storage: LocalMediaStorage;
let repository: MediaRepository;
let media: MediaService;
let processing: MediaProcessingService;
let jobs: JobRepository<FoundationDatabase>;
let dispatcher: OutboxDispatcher<FoundationDatabase>;
let editor: SessionActor;
let admin: SessionActor;
let viewer: SessionActor;
let itemPublicId: string;
let sourceImages: Record<string, Buffer>;

function actorFor(id: string, role: 'editor' | 'admin' | 'viewer'): SessionActor {
  return {
    id,
    email: `processing-${role}@example.test`,
    displayName: `Synthetic ${role}`,
    locale: 'en',
    role,
    permissions: permissionsFor(role),
  };
}

async function attach(
  filename: string,
  bytes: Buffer,
  mimeType: string,
  input: { role?: string; visibility?: string } = {},
) {
  const session = await media.beginUpload(editor, {
    itemPublicId,
    filename,
    mimeType,
    byteSize: bytes.byteLength,
  });
  await media.receiveContent(editor, session.sessionId, Readable.from([bytes]));
  return media.finalizeUpload(editor, session.sessionId, {
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    ...input,
  });
}

/**
 * Drains the outbox into jobs and runs the queue until nothing is left to claim. Each pass waits
 * for the work it claimed, because the runner deliberately claims no more than its concurrency
 * budget while a job is still in flight.
 */
async function runQueue(handler?: JobHandler): Promise<void> {
  const runner = new JobRunner(
    jobs,
    new Map([
      [
        'media.process-v1',
        handler ?? ((payload, context) => processing.handleJob(payload, () => context.heartbeat())),
      ],
    ]),
    { dispatcher, workerId: 'integration-runner' },
  );
  for (;;) {
    const claimed = await runner.runOnce();
    await runner.stop();
    if (claimed === 0) return;
  }
}

async function assetRow(id: string) {
  return (
    await pool.query(
      'select processing_state, width, height, metadata_json, source_asset_id from media_assets where id = $1',
      [id],
    )
  ).rows[0];
}

suite('MED-02 media processing', () => {
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
    database = createDatabase(schemaUrl, 4);
    mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'atlas-processing-'));
    storage = new LocalMediaStorage(mediaRoot);
    repository = new MediaRepository(prisma);
    jobs = new JobRepository(database);
    dispatcher = new OutboxDispatcher(database, jobs);
    processing = new MediaProcessingService(
      repository,
      storage,
      new ChildImageProcessor({
        maxInputBytes: maxUploadBytes,
        maxPixels: 40_000_000,
        childRssMb: 512,
        childTimeoutMs: 30_000,
        concurrency: 1,
      }),
      maxUploadBytes,
      () => instant,
    );

    const editorId = randomUUID();
    const adminId = randomUUID();
    const viewerId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: editorId,
          emailNormalized: 'processing-editor@example.test',
          displayName: 'Synthetic Editor',
          passwordHash: '$argon2id$synthetic',
          role: 'editor',
        },
        {
          id: adminId,
          emailNormalized: 'processing-admin@example.test',
          displayName: 'Synthetic Admin',
          passwordHash: '$argon2id$synthetic',
          role: 'admin',
        },
        {
          id: viewerId,
          emailNormalized: 'processing-viewer@example.test',
          displayName: 'Synthetic Viewer',
          passwordHash: '$argon2id$synthetic',
          role: 'viewer',
        },
      ],
    });
    editor = actorFor(editorId, 'editor');
    admin = actorFor(adminId, 'admin');
    viewer = actorFor(viewerId, 'viewer');

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
    itemPublicId = randomUUID();
    await prisma.item.create({
      data: {
        id: randomUUID(),
        publicId: itemPublicId,
        slug: 'camera',
        categoryId,
        lifecycleStatusId,
        displayName: 'Camera',
        createdAt: instant,
        updatedAt: instant,
      },
    });

    media = new MediaService(
      repository,
      storage,
      new CatalogMediaOwnerAdapter(new ItemRepository(prisma)),
      { audit: new TransactionalAuditPort(), outbox: new TransactionalOutboxPort() },
      maxUploadBytes,
      '/api/v1/media',
      randomUUID,
      () => instant,
    );

    const fixtures = await mediaCapabilityFixtures();
    sourceImages = Object.fromEntries(
      await Promise.all(
        fixtures.map(async (fixture) => [fixture.format, await readFile(fixture.path)] as const),
      ),
    );
  });

  afterAll(async () => {
    await database?.destroy();
    await prisma?.$disconnect();
    await pool?.end();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('processes an uploaded image from the outbox message the upload committed', async () => {
    const attached = await attach('front.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'primary',
    });
    expect(attached.processingState).toBe('pending');
    expect(attached.variants).toEqual([]);
    expect(attached.thumbnailUrl).toBeNull();

    await runQueue();

    const row = await assetRow(attached.assetId);
    expect(row).toMatchObject({ processing_state: 'ready', width: 16, height: 16 });
    expect(row.metadata_json).toMatchObject({
      processor: 'libvips',
      metadataStripped: true,
      loader: 'jpegload',
    });
    // Technical facts only: no EXIF, GPS, camera identity or filename leaks into the row.
    expect(JSON.stringify(row.metadata_json).toLowerCase()).not.toContain('gps');

    const [listed] = await media.listItemMedia(editor, itemPublicId);
    expect(listed!.processingState).toBe('ready');
    expect(listed!.variants.map((variant) => variant.name)).toEqual(['thumb']);
    expect(listed!.thumbnailUrl).toBe(listed!.variants[0]!.contentUrl);
    expect(listed!.variants[0]).toMatchObject({ mimeType: 'image/webp', width: 16, height: 16 });
    expect(await storage.exists(variantStorageKey(attached.assetId, 'thumb'))).toBe(true);

    const job = await jobs.findByIdempotencyKey(`media.process-v1:${attached.assetId}`);
    expect(job).toMatchObject({ state: 'succeeded' });
  });

  it('decodes every approved format, HEIC included', async () => {
    for (const [format, extension, mimeType] of [
      ['png', 'png', 'image/png'],
      ['webp', 'webp', 'image/webp'],
      ['heic', 'heic', 'image/heic'],
    ] as const) {
      const attached = await attach(`capability.${extension}`, sourceImages[format]!, mimeType, {
        role: 'gallery',
      });
      await runQueue();
      expect(await assetRow(attached.assetId)).toMatchObject({
        processing_state: 'ready',
        width: 16,
        height: 16,
      });
      expect(await repository.listVariants(attached.assetId)).toHaveLength(1);
    }
  });

  it('serves a variant only to an actor allowed to see its source image', async () => {
    const attached = await attach('private.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'gallery',
      visibility: 'private',
    });
    await runQueue();
    const [variant] = await repository.listVariants(attached.assetId);
    expect(variant).toBeDefined();
    const opened = await media.openAssetContent(admin, variant!.id);
    expect(opened.asset.mimeType).toBe('image/webp');
    opened.content.destroy();
    // A viewer cannot reach the private image through its derived thumbnail either.
    await expect(media.openAssetContent(viewer, variant!.id)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
    await expect(media.openAssetContent(viewer, attached.assetId)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
  });

  it('is idempotent: reprocessing replaces the variant set instead of duplicating it', async () => {
    const attached = await attach('repeat.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'gallery',
    });
    await processing.processAsset(attached.assetId);
    const first = await repository.listVariants(attached.assetId);
    await processing.processAsset(attached.assetId);
    const second = await repository.listVariants(attached.assetId);
    expect(second).toHaveLength(first.length);
    expect(second[0]!.checksumSha256).toBe(first[0]!.checksumSha256);
    expect(second[0]!.storageKey).toBe(first[0]!.storageKey);
    expect(second[0]!.id).not.toBe(first[0]!.id);
  });

  it('never treats a variant as a processing input', async () => {
    const attached = await attach('skip.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'gallery',
    });
    await processing.processAsset(attached.assetId);
    const [variant] = await repository.listVariants(attached.assetId);
    expect(await processing.processAsset(variant!.id)).toMatchObject({ state: 'skipped' });
  });

  it('marks an undecodable image failed and sends its job to dead state', async () => {
    // A file whose header passes the upload signature check but whose body is not an image.
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x2a)]);
    const attached = await attach('broken.jpg', broken, 'image/jpeg', { role: 'gallery' });
    await runQueue();

    const job = await jobs.findByIdempotencyKey(`media.process-v1:${attached.assetId}`);
    expect(job).toMatchObject({ state: 'dead', attempt: 1 });
    expect(job!.lastErrorCode).toMatch(/^MEDIA_DECODE_/u);
    const row = await assetRow(attached.assetId);
    expect(row).toMatchObject({ processing_state: 'failed' });
    expect(String(row.metadata_json.failureCode)).toMatch(/^MEDIA_DECODE_/u);

    // A failed asset advertises no renditions, so a card never links a half-processed image.
    const listed = (await media.listItemMedia(editor, itemPublicId)).find(
      (entry) => entry.assetId === attached.assetId,
    );
    expect(listed).toMatchObject({ processingState: 'failed', thumbnailUrl: null });
    expect(listed!.variants).toEqual([]);
  });

  it('retries a crashed child and leaves the asset pending for the retry', async () => {
    const attached = await attach('crash.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'gallery',
    });
    await runQueue(async () => {
      const crash = new Error('The image processing child was terminated by SIGKILL.');
      (crash as Error & { code: string }).code = 'MEDIA_PROCESSING_CHILD_CRASHED';
      throw crash;
    });
    const job = await jobs.findByIdempotencyKey(`media.process-v1:${attached.assetId}`);
    expect(job).toMatchObject({
      state: 'retry_wait',
      lastErrorCode: 'MEDIA_PROCESSING_CHILD_CRASHED',
    });
    expect(job!.availableAt.getTime()).toBeGreaterThan(job!.createdAt.getTime());
    // Nothing is marked failed: the next attempt may still succeed.
    expect(await assetRow(attached.assetId)).toMatchObject({ processing_state: 'pending' });
  });

  it('removes the derived objects when the source asset is reclaimed', async () => {
    const attached = await attach('detached.jpg', sourceImages.jpeg!, 'image/jpeg', {
      role: 'gallery',
    });
    await processing.processAsset(attached.assetId);
    const variantKey = variantStorageKey(attached.assetId, 'thumb');
    expect(await storage.exists(variantKey)).toBe(true);

    const owner = (await media.listItemMedia(editor, itemPublicId)).find(
      (entry) => entry.assetId === attached.assetId,
    )!;
    const version = Number(
      (await pool.query('select version from items where public_id = $1', [itemPublicId])).rows[0]
        .version,
    );
    await media.detachRelation(editor, owner.relationId, version);
    await pool.query('update media_assets set delete_after = $1 where id = $2', [
      new Date(instant.getTime() - 1_000),
      attached.assetId,
    ]);

    const collected = await media.collectOrphans();
    expect(collected.deleted).toContain(attached.assetId);
    expect(await storage.exists(variantKey)).toBe(false);
    expect(await repository.findAsset(attached.assetId)).toBeNull();
  });
});
