/**
 * Container-level metadata removal for the WebP variants MED-02 writes.
 *
 * The pinned libvips (8.14.1) ignores the `strip` save option for WebP and writes an `EXIF`
 * chunk into every output - including one synthesised for a source that had no EXIF at all - so
 * a GPS tag on an uploaded photograph survives into the published thumbnail. The metadata policy
 * in `image-variants.ts` is not advisory, so the guarantee is enforced here on the bytes instead
 * of delegated to a flag this version does not honour.
 *
 * This walks the RIFF container only. It never touches compressed image data, so it cannot
 * corrupt pixels and needs no decoder.
 */

/** Chunks that can carry author, device or location information. */
const metadataChunks = new Set(['EXIF', 'XMP ', 'ICCP']);

/** VP8X feature flags for the chunks above: ICC 0x20, EXIF 0x08, XMP 0x04. */
const metadataFlagMask = 0x20 | 0x08 | 0x04;

export class WebpContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebpContainerError';
  }
}

/**
 * Returns the same image with every metadata chunk removed and the VP8X feature flags that
 * announced them cleared. A file that already carries no metadata is returned unchanged.
 */
export function stripWebpMetadata(file: Buffer): Buffer {
  if (
    file.length < 12 ||
    file.toString('ascii', 0, 4) !== 'RIFF' ||
    file.toString('ascii', 8, 12) !== 'WEBP'
  )
    throw new WebpContainerError('The produced variant is not a WebP container.');

  const kept: Buffer[] = [];
  let removed = 0;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const fourCc = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    // RIFF pads every odd-sized payload to an even boundary.
    const end = offset + 8 + size + (size % 2);
    if (end > file.length)
      throw new WebpContainerError('The produced variant has a truncated WebP chunk.');
    if (metadataChunks.has(fourCc)) removed += 1;
    else kept.push(file.subarray(offset, end));
    offset = end;
  }
  if (!removed) return file;

  const body = Buffer.concat(kept);
  if (body.length >= 18 && body.toString('ascii', 0, 4) === 'VP8X')
    body[8] = (body[8] ?? 0) & ~metadataFlagMask;
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** Lists the metadata chunks a WebP still carries; empty means the policy holds. */
export function webpMetadataChunks(file: Buffer): string[] {
  const found: string[] = [];
  let offset = 12;
  while (offset + 8 <= file.length) {
    const fourCc = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    if (metadataChunks.has(fourCc)) found.push(fourCc);
    offset += 8 + size + (size % 2);
  }
  return found;
}
