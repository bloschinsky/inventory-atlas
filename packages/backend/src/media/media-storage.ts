import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { mediaLimits } from './media-policy.js';

/** What the storage adapter observed while it consumed the upload stream. */
export interface StoredUpload {
  byteSize: number;
  checksumSha256: string;
  /** The first bytes of the object, used for signature detection without re-reading the file. */
  head: Uint8Array;
}

export class MediaStorageLimitError extends Error {
  readonly code = 'MEDIA_SIZE_EXCEEDED';

  constructor(readonly maxBytes: number) {
    super(`An upload may contain at most ${maxBytes} bytes.`);
    this.name = 'MediaStorageLimitError';
  }
}

/**
 * The byte-level media contract. Local storage is the default and only mandatory driver; an
 * S3-compatible adapter implements the same port without changing any caller, which is why the
 * service never touches a filesystem path itself.
 */
export interface MediaStoragePort {
  /** Streams an upload into temporary storage, enforcing the byte ceiling as it writes. */
  writeTemp(key: string, source: Readable, maxBytes: number): Promise<StoredUpload>;
  /** Moves a verified temporary object into its permanent key. */
  promote(temporaryKey: string, finalKey: string): Promise<void>;
  openRead(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** Removes an object; a missing object is not an error. */
  remove(key: string): Promise<void>;
}

/** Builds the temporary key for one upload session. */
export function temporaryUploadKey(sessionId: string): string {
  return `tmp/${sessionId}`;
}

/**
 * Permanent keys are content-addressed by a fresh asset id and fanned out over two directory
 * levels, so one directory never accumulates every object and no client string reaches the path.
 */
export function assetStorageKey(assetId: string, extension: string): string {
  const flat = assetId.replaceAll('-', '');
  const suffix = /^[a-z0-9]{1,8}$/u.test(extension) ? `.${extension}` : '';
  return `assets/${flat.slice(0, 2)}/${flat.slice(2, 4)}/${flat}${suffix}`;
}

export class LocalMediaStorage implements MediaStoragePort {
  constructor(
    private readonly root: string,
    private readonly newId: () => string = randomUUID,
  ) {}

  async writeTemp(key: string, source: Readable, maxBytes: number): Promise<StoredUpload> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let byteSize = 0;
    let headLength = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.from(chunk);
        byteSize += buffer.byteLength;
        if (byteSize > maxBytes) {
          callback(new MediaStorageLimitError(maxBytes));
          return;
        }
        hash.update(buffer);
        if (headLength < mediaLimits.signatureBytes) {
          const slice = buffer.subarray(0, mediaLimits.signatureBytes - headLength);
          headChunks.push(slice);
          headLength += slice.byteLength;
        }
        callback(null, buffer);
      },
    });
    // A partially written temporary object must never survive a rejected upload.
    const staging = `${target}.${this.newId()}.part`;
    try {
      await pipeline(source, meter, createWriteStream(staging));
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { force: true });
      await rm(target, { force: true });
      throw error;
    }
    return { byteSize, checksumSha256: hash.digest('hex'), head: Buffer.concat(headChunks) };
  }

  async promote(temporaryKey: string, finalKey: string): Promise<void> {
    const target = this.resolve(finalKey);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(this.resolve(temporaryKey), target);
  }

  async openRead(key: string): Promise<Readable> {
    const target = this.resolve(key);
    await stat(target);
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Keys are server-generated, but the adapter still refuses to leave its own root. */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    const root = path.resolve(this.root);
    if (target !== root && !target.startsWith(root + path.sep))
      throw new Error('A media storage key must stay inside the media root.');
    return target;
  }
}
