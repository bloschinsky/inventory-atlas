/**
 * Media module domain policy: the approved upload surface and the checks that must pass before
 * any byte is promoted into permanent storage. Nothing here decodes an image; decoding is
 * MED-02's isolated child process. Signature detection reads a fixed-length header only.
 */

export const approvedImageMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;
export type ApprovedImageMimeType = (typeof approvedImageMimeTypes)[number];

export const mediaRelationRoles = ['primary', 'gallery', 'container_photo'] as const;
export type MediaRelationRole = (typeof mediaRelationRoles)[number];

export const mediaVisibilities = ['public', 'authenticated', 'private'] as const;
export type MediaVisibility = (typeof mediaVisibilities)[number];

export const mediaLimits = Object.freeze({
  maxFilenameLength: 255,
  /** How long an authorized upload session may stay open. */
  sessionTtlMs: 15 * 60 * 1_000,
  /** How long a detached asset survives before orphan cleanup may remove it. */
  orphanGraceMs: 24 * 60 * 60 * 1_000,
  /** Bytes of the file header the signature check inspects. */
  signatureBytes: 32,
});

/** Extensions accepted for each approved type; the declared MIME must agree with the extension. */
const extensionsByMime: Readonly<Record<ApprovedImageMimeType, readonly string[]>> = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic', 'heif'],
});

export type MediaPolicyCode =
  | 'MEDIA_FILENAME_REQUIRED'
  | 'MEDIA_FILENAME_TOO_LONG'
  | 'MEDIA_TYPE_UNSUPPORTED'
  | 'MEDIA_TYPE_EXTENSION_MISMATCH'
  | 'MEDIA_SIZE_REQUIRED'
  | 'MEDIA_SIZE_EXCEEDED'
  | 'MEDIA_SIZE_MISMATCH'
  | 'MEDIA_CHECKSUM_MISMATCH'
  | 'MEDIA_SIGNATURE_UNRECOGNIZED'
  | 'MEDIA_SIGNATURE_MISMATCH'
  | 'MEDIA_ROLE_INVALID'
  | 'MEDIA_VISIBILITY_INVALID'
  | 'MEDIA_ALT_TEXT_INVALID'
  | 'MEDIA_ORDER_INVALID';

export class MediaPolicyError extends Error {
  constructor(
    readonly code: MediaPolicyCode,
    readonly fieldKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'MediaPolicyError';
  }
}

/**
 * Reduces a client filename to a safe display value: no directory component, no control
 * character, no leading dot, and a bounded length. The stored object never uses this name.
 */
export function normalizeUploadFilename(value: unknown): string {
  if (typeof value !== 'string')
    throw new MediaPolicyError('MEDIA_FILENAME_REQUIRED', 'filename', 'A filename is required.');
  const base = value
    .split(/[\\/]/u)
    .at(-1)!
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .replace(/^\.+/u, '')
    .trim();
  if (!base)
    throw new MediaPolicyError('MEDIA_FILENAME_REQUIRED', 'filename', 'A filename is required.');
  if (base.length > mediaLimits.maxFilenameLength)
    throw new MediaPolicyError(
      'MEDIA_FILENAME_TOO_LONG',
      'filename',
      `A filename may contain at most ${mediaLimits.maxFilenameLength} characters.`,
    );
  return base;
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function validateMimeType(value: unknown): ApprovedImageMimeType {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!approvedImageMimeTypes.includes(mimeType as ApprovedImageMimeType))
    throw new MediaPolicyError(
      'MEDIA_TYPE_UNSUPPORTED',
      'mimeType',
      'Only JPEG, PNG, WebP and HEIC images are accepted.',
    );
  return mimeType as ApprovedImageMimeType;
}

/** The declared type and the filename extension must describe the same format. */
export function requireExtensionAgreement(filename: string, mimeType: ApprovedImageMimeType): void {
  if (!extensionsByMime[mimeType].includes(fileExtension(filename)))
    throw new MediaPolicyError(
      'MEDIA_TYPE_EXTENSION_MISMATCH',
      'filename',
      'The file extension does not match the declared media type.',
    );
}

export function validateDeclaredByteSize(value: unknown, maxUploadBytes: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new MediaPolicyError(
      'MEDIA_SIZE_REQUIRED',
      'byteSize',
      'A positive declared byte size is required.',
    );
  if ((value as number) > maxUploadBytes)
    throw new MediaPolicyError(
      'MEDIA_SIZE_EXCEEDED',
      'byteSize',
      `An upload may contain at most ${maxUploadBytes} bytes.`,
    );
  return value as number;
}

export function validateRole(value: unknown): MediaRelationRole {
  const role = value ?? 'gallery';
  if (!mediaRelationRoles.includes(role as MediaRelationRole))
    throw new MediaPolicyError('MEDIA_ROLE_INVALID', 'role', 'The media role is invalid.');
  return role as MediaRelationRole;
}

export function validateMediaVisibility(value: unknown): MediaVisibility {
  const visibility = value ?? 'authenticated';
  if (!mediaVisibilities.includes(visibility as MediaVisibility))
    throw new MediaPolicyError(
      'MEDIA_VISIBILITY_INVALID',
      'visibility',
      'The media visibility is invalid.',
    );
  return visibility as MediaVisibility;
}

export function normalizeAltText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new MediaPolicyError('MEDIA_ALT_TEXT_INVALID', 'altText', 'Alt text must be text.');
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text) return null;
  if (text.length > 1_000)
    throw new MediaPolicyError(
      'MEDIA_ALT_TEXT_INVALID',
      'altText',
      'Alt text may contain at most 1000 characters.',
    );
  return text;
}

/**
 * Recognizes the container format from the file header. This is the authority on what was
 * actually uploaded; the client's declared type is only a hint that must agree with it.
 */
export function detectImageSignature(head: Uint8Array): ApprovedImageMimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return 'image/jpeg';
  if (
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte)
  )
    return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP')
    return 'image/webp';
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12).toLowerCase();
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
  }
  return null;
}

/**
 * Final gate before an asset row exists: the received bytes must match the declared size, the
 * caller's checksum when one was supplied, and a recognized signature that agrees with the
 * declared type.
 */
export function verifyReceivedUpload(input: {
  declaredByteSize: number;
  declaredMimeType: ApprovedImageMimeType;
  receivedByteSize: number;
  checksumSha256: string;
  expectedChecksum?: string | null;
  head: Uint8Array;
  maxUploadBytes: number;
}): ApprovedImageMimeType {
  if (input.receivedByteSize > input.maxUploadBytes)
    throw new MediaPolicyError(
      'MEDIA_SIZE_EXCEEDED',
      'byteSize',
      `An upload may contain at most ${input.maxUploadBytes} bytes.`,
    );
  if (input.receivedByteSize !== input.declaredByteSize)
    throw new MediaPolicyError(
      'MEDIA_SIZE_MISMATCH',
      'byteSize',
      'The uploaded byte count does not match the declared size.',
    );
  if (
    input.expectedChecksum &&
    input.expectedChecksum.toLowerCase() !== input.checksumSha256.toLowerCase()
  )
    throw new MediaPolicyError(
      'MEDIA_CHECKSUM_MISMATCH',
      'checksumSha256',
      'The uploaded checksum does not match the supplied checksum.',
    );
  const detected = detectImageSignature(input.head);
  if (!detected)
    throw new MediaPolicyError(
      'MEDIA_SIGNATURE_UNRECOGNIZED',
      'content',
      'The uploaded bytes are not a supported image.',
    );
  if (detected !== input.declaredMimeType)
    throw new MediaPolicyError(
      'MEDIA_SIGNATURE_MISMATCH',
      'content',
      'The uploaded bytes do not match the declared media type.',
    );
  return detected;
}

/** Positions are always rewritten as a contiguous run from zero, so ordering stays stable. */
export function validateOrderedIds(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new MediaPolicyError(
      'MEDIA_ORDER_INVALID',
      'order',
      'An ordered relation list is required.',
    );
  const ordered = value.map((entry) => String(entry));
  if (new Set(ordered).size !== ordered.length)
    throw new MediaPolicyError(
      'MEDIA_ORDER_INVALID',
      'order',
      'The ordered relation list contains a duplicate.',
    );
  if (ordered.length !== known.size || ordered.some((id) => !known.has(id)))
    throw new MediaPolicyError(
      'MEDIA_ORDER_INVALID',
      'order',
      'The ordered relation list must contain every active gallery relation exactly once.',
    );
  return ordered;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
