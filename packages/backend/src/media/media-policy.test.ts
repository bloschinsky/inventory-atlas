import { describe, expect, it } from 'vitest';
import {
  detectImageSignature,
  mediaLimits,
  normalizeAltText,
  normalizeUploadFilename,
  requireExtensionAgreement,
  validateDeclaredByteSize,
  validateMediaVisibility,
  validateMimeType,
  validateOrderedIds,
  validateRole,
  verifyReceivedUpload,
} from './media-policy.js';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const webp = header('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const heic = header('\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000');

describe('MED-01A upload declaration policy', () => {
  it('strips any directory component and control characters from a filename', () => {
    expect(normalizeUploadFilename('../../etc/passwd.png')).toBe('passwd.png');
    expect(normalizeUploadFilename('C:\\Users\\me\\photo.jpg')).toBe('photo.jpg');
    expect(normalizeUploadFilename('ph\u0000oto\u200b.jpg')).toBe('photo.jpg');
    expect(normalizeUploadFilename('   .hidden.png  ')).toBe('hidden.png');
  });

  it('rejects an empty, over-long, or non-string filename', () => {
    expect(() => normalizeUploadFilename('   ')).toThrow(
      expect.objectContaining({
        code: 'MEDIA_FILENAME_REQUIRED',
      }),
    );
    expect(() => normalizeUploadFilename(42)).toThrow(
      expect.objectContaining({ code: 'MEDIA_FILENAME_REQUIRED' }),
    );
    expect(() =>
      normalizeUploadFilename(`${'a'.repeat(mediaLimits.maxFilenameLength)}.jpg`),
    ).toThrow(expect.objectContaining({ code: 'MEDIA_FILENAME_TOO_LONG' }));
  });

  it('accepts only the approved image types', () => {
    expect(validateMimeType('IMAGE/JPEG')).toBe('image/jpeg');
    for (const rejected of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])
      expect(() => validateMimeType(rejected), rejected).toThrow(
        expect.objectContaining({
          code: 'MEDIA_TYPE_UNSUPPORTED',
        }),
      );
  });

  it('requires the extension and the declared type to agree', () => {
    expect(() => requireExtensionAgreement('photo.jpeg', 'image/jpeg')).not.toThrow();
    expect(() => requireExtensionAgreement('photo.heif', 'image/heic')).not.toThrow();
    expect(() => requireExtensionAgreement('photo.png', 'image/jpeg')).toThrow(
      expect.objectContaining({
        code: 'MEDIA_TYPE_EXTENSION_MISMATCH',
      }),
    );
    expect(() => requireExtensionAgreement('photo', 'image/png')).toThrow(
      expect.objectContaining({
        code: 'MEDIA_TYPE_EXTENSION_MISMATCH',
      }),
    );
  });

  it('enforces the declared byte limit', () => {
    expect(validateDeclaredByteSize(1_024, 2_048)).toBe(1_024);
    expect(() => validateDeclaredByteSize(0, 2_048)).toThrow(
      expect.objectContaining({ code: 'MEDIA_SIZE_REQUIRED' }),
    );
    expect(() => validateDeclaredByteSize(4_096, 2_048)).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SIZE_EXCEEDED',
      }),
    );
  });

  it('normalizes roles, visibility and alt text', () => {
    expect(validateRole(undefined)).toBe('gallery');
    expect(validateRole('primary')).toBe('primary');
    expect(() => validateRole('thumbnail')).toThrow(
      expect.objectContaining({ code: 'MEDIA_ROLE_INVALID' }),
    );
    expect(validateMediaVisibility(undefined)).toBe('authenticated');
    expect(() => validateMediaVisibility('unlisted')).toThrow(
      expect.objectContaining({
        code: 'MEDIA_VISIBILITY_INVALID',
      }),
    );
    expect(normalizeAltText('  Front   view ')).toBe('Front view');
    expect(normalizeAltText('   ')).toBeNull();
    expect(() => normalizeAltText('a'.repeat(1_001))).toThrow(
      expect.objectContaining({
        code: 'MEDIA_ALT_TEXT_INVALID',
      }),
    );
  });
});

describe('MED-01A file signature detection', () => {
  it('recognizes every approved container format', () => {
    expect(detectImageSignature(jpeg)).toBe('image/jpeg');
    expect(detectImageSignature(png)).toBe('image/png');
    expect(detectImageSignature(webp)).toBe('image/webp');
    expect(detectImageSignature(heic)).toBe('image/heic');
    expect(detectImageSignature(header('\u0000\u0000\u0000\u0018ftypmif1____'))).toBe('image/heic');
  });

  it('refuses unrecognized, truncated and disguised content', () => {
    expect(detectImageSignature(header('<?xml version="1.0"?><svg'))).toBeNull();
    expect(detectImageSignature(header('GIF89a'))).toBeNull();
    expect(detectImageSignature(header('%PDF-1.7'))).toBeNull();
    expect(detectImageSignature(header('RIFF\u0000\u0000\u0000\u0000AVI '))).toBeNull();
    expect(detectImageSignature(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageSignature(new Uint8Array())).toBeNull();
  });
});

describe('MED-01B received-upload verification', () => {
  const base = {
    declaredByteSize: 8,
    declaredMimeType: 'image/jpeg' as const,
    receivedByteSize: 8,
    checksumSha256: 'a'.repeat(64),
    head: jpeg,
    maxUploadBytes: 1_024,
  };

  it('accepts a matching upload', () => {
    expect(verifyReceivedUpload({ ...base, expectedChecksum: 'A'.repeat(64) })).toBe('image/jpeg');
  });

  it('rejects a size, checksum or limit mismatch', () => {
    expect(() => verifyReceivedUpload({ ...base, receivedByteSize: 9 })).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SIZE_MISMATCH',
      }),
    );
    expect(() => verifyReceivedUpload({ ...base, expectedChecksum: 'b'.repeat(64) })).toThrow(
      expect.objectContaining({ code: 'MEDIA_CHECKSUM_MISMATCH' }),
    );
    expect(() =>
      verifyReceivedUpload({ ...base, receivedByteSize: 2_048, maxUploadBytes: 1_024 }),
    ).toThrow(expect.objectContaining({ code: 'MEDIA_SIZE_EXCEEDED' }));
  });

  it('rejects content whose signature is missing or contradicts the declared type', () => {
    expect(() => verifyReceivedUpload({ ...base, head: header('GIF89a__') })).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SIGNATURE_UNRECOGNIZED',
      }),
    );
    expect(() => verifyReceivedUpload({ ...base, head: png })).toThrow(
      expect.objectContaining({
        code: 'MEDIA_SIGNATURE_MISMATCH',
      }),
    );
  });
});

describe('MED-01B gallery ordering policy', () => {
  const known = new Set(['a', 'b', 'c']);

  it('accepts a complete permutation', () => {
    expect(validateOrderedIds(['c', 'a', 'b'], known)).toEqual(['c', 'a', 'b']);
  });

  it('rejects a partial list, a duplicate, an unknown id and an empty list', () => {
    for (const order of [['a', 'b'], ['a', 'a', 'b'], ['a', 'b', 'd'], [], 'a'])
      expect(() => validateOrderedIds(order, known), JSON.stringify(order)).toThrow(
        expect.objectContaining({
          code: 'MEDIA_ORDER_INVALID',
        }),
      );
  });
});

/** @param text latin-1 header bytes written as a string for readability */
function header(text: string): Uint8Array {
  return Uint8Array.from([...text].map((character) => character.charCodeAt(0)));
}
