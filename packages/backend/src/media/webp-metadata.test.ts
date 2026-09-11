import { describe, expect, it } from 'vitest';
import { stripWebpMetadata, webpMetadataChunks, WebpContainerError } from './webp-metadata.js';

function chunk(fourCc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourCc, 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  // RIFF pads an odd payload to an even boundary.
  const padding = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, padding]);
}

function webp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** VP8X: flags byte, three reserved bytes, canvas width-1 and height-1 as 24-bit values. */
function vp8x(flags: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(15, 4, 3);
  payload.writeUIntLE(15, 7, 3);
  return chunk('VP8X', payload);
}

const pixels = chunk('VP8 ', Buffer.alloc(20, 0x11));

describe('webp metadata removal', () => {
  it('removes the EXIF, XMP and ICC chunks a decoder wrote', () => {
    const file = webp([
      vp8x(0x20 | 0x08 | 0x04),
      pixels,
      chunk('EXIF', Buffer.from('gps latitude 50.45', 'ascii')),
      chunk('XMP ', Buffer.from('<x:xmpmeta/>', 'ascii')),
      chunk('ICCP', Buffer.alloc(32, 7)),
    ]);
    expect(webpMetadataChunks(file).sort()).toEqual(['EXIF', 'ICCP', 'XMP ']);
    const stripped = stripWebpMetadata(file);
    expect(webpMetadataChunks(stripped)).toEqual([]);
    expect(stripped.includes(Buffer.from('gps latitude', 'ascii'))).toBe(false);
  });

  it('clears the VP8X flags that announced the removed chunks', () => {
    const stripped = stripWebpMetadata(
      webp([vp8x(0x20 | 0x10 | 0x08 | 0x04), pixels, chunk('EXIF', Buffer.alloc(4, 1))]),
    );
    // Only the alpha flag survives: the image still has an alpha channel.
    expect(stripped[20]).toBe(0x10);
  });

  it('keeps the pixel data and rewrites the container size', () => {
    const file = webp([vp8x(0x08), pixels, chunk('EXIF', Buffer.alloc(9, 2))]);
    const stripped = stripWebpMetadata(file);
    expect(stripped.toString('ascii', 0, 4)).toBe('RIFF');
    expect(stripped.toString('ascii', 8, 12)).toBe('WEBP');
    expect(stripped.readUInt32LE(4)).toBe(stripped.length - 8);
    expect(stripped.includes(pixels)).toBe(true);
  });

  it('returns a file that already carries no metadata unchanged', () => {
    const file = webp([pixels]);
    expect(stripWebpMetadata(file)).toBe(file);
  });

  it('refuses bytes that are not a WebP container or are truncated', () => {
    expect(() => stripWebpMetadata(Buffer.from('not a webp at all'))).toThrow(WebpContainerError);
    const truncated = webp([pixels, chunk('EXIF', Buffer.alloc(8, 1))]).subarray(0, 30);
    expect(() => stripWebpMetadata(truncated)).toThrow(WebpContainerError);
  });
});
