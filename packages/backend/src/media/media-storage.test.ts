import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assetStorageKey,
  LocalMediaStorage,
  MediaStorageLimitError,
  temporaryUploadKey,
} from './media-storage.js';

let root: string;
let storage: LocalMediaStorage;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'atlas-media-'));
  storage = new LocalMediaStorage(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('MED-01A local media storage', () => {
  it('streams an upload while computing its size, checksum and header', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 7)]);
    const key = temporaryUploadKey(randomUUID());
    const stored = await storage.writeTemp(key, Readable.from(chunks(bytes, 16)), 1_024);

    expect(stored.byteSize).toBe(bytes.byteLength);
    expect(stored.checksumSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect([...stored.head.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(stored.head).toHaveLength(32);
    expect(await storage.exists(key)).toBe(true);
  });

  it('aborts an oversized upload and leaves nothing behind', async () => {
    const key = temporaryUploadKey(randomUUID());
    await expect(
      storage.writeTemp(key, Readable.from(chunks(Buffer.alloc(4_096, 1), 64)), 1_024),
    ).rejects.toBeInstanceOf(MediaStorageLimitError);
    expect(await storage.exists(key)).toBe(false);
    expect((await entries()).some((name) => name.includes('.part'))).toBe(false);
  });

  it('promotes a temporary object to its permanent key and reads it back', async () => {
    const key = temporaryUploadKey(randomUUID());
    await storage.writeTemp(key, Readable.from([Buffer.from('image-bytes')]), 1_024);
    const finalKey = assetStorageKey('0198f40c-92f3-7a12-bc9a-653f97786c40', 'jpg');
    expect(finalKey).toBe('assets/01/98/0198f40c92f37a12bc9a653f97786c40.jpg');

    await storage.promote(key, finalKey);
    expect(await storage.exists(key)).toBe(false);
    const content = await storage.openRead(finalKey);
    expect(Buffer.concat(await collect(content)).toString()).toBe('image-bytes');

    await storage.remove(finalKey);
    expect(await storage.exists(finalKey)).toBe(false);
    // Removing a missing object stays a no-op so cleanup can be retried safely.
    await expect(storage.remove(finalKey)).resolves.toBeUndefined();
  });

  it('drops an extension it does not recognize instead of trusting it', () => {
    expect(assetStorageKey('0198f40c-92f3-7a12-bc9a-653f97786c40', '../../etc/passwd')).toBe(
      'assets/01/98/0198f40c92f37a12bc9a653f97786c40',
    );
  });

  it('refuses a key that would escape the media root', async () => {
    await expect(storage.exists('../escaped')).resolves.toBe(false);
    await expect(storage.openRead('../../etc/passwd')).rejects.toThrow(
      'A media storage key must stay inside the media root.',
    );
    await expect(storage.remove('../../etc/passwd')).rejects.toThrow(
      'A media storage key must stay inside the media root.',
    );
  });

  it('reports a missing object as absent rather than throwing from exists', async () => {
    expect(await storage.exists('assets/does/not/exist.jpg')).toBe(false);
    await expect(storage.openRead('assets/does/not/exist.jpg')).rejects.toThrow();
  });
});

/** Files remaining under the temporary prefix, used to prove failed uploads leave no residue. */
async function entries(): Promise<string[]> {
  try {
    return await readdir(path.join(root, 'tmp'));
  } catch {
    return [];
  }
}

function chunks(buffer: Buffer, size: number): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += size)
    parts.push(buffer.subarray(offset, offset + size));
  return parts;
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return parts;
}
