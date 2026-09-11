/**
 * The variant plan and the metadata policy for processed images (blueprint section 12.1 step 5).
 * Pure data and pure functions: nothing here decodes anything, so the plan can be asserted in a
 * unit test and reused by the isolated child process without pulling a decoder into scope.
 */

export const variantNames = ['thumb', 'card', 'preview'] as const;
export type VariantName = (typeof variantNames)[number];

export interface VariantDefinition {
  readonly name: VariantName;
  /** Longest edge in pixels; the aspect ratio is always preserved. */
  readonly maxEdge: number;
  readonly format: 'webp';
  readonly mimeType: 'image/webp';
  readonly quality: number;
  /** `thumb` is produced for every asset, however small the source is. */
  readonly always: boolean;
}

/**
 * One delivery format. WebP is decoded by every browser in the recorded support matrix, and a
 * single format keeps the stored variant count - and the reclaim surface - small.
 */
export const variantPlan: readonly VariantDefinition[] = Object.freeze([
  Object.freeze({
    name: 'thumb',
    maxEdge: 320,
    format: 'webp',
    mimeType: 'image/webp',
    quality: 80,
    always: true,
  }),
  Object.freeze({
    name: 'card',
    maxEdge: 800,
    format: 'webp',
    mimeType: 'image/webp',
    quality: 82,
    always: false,
  }),
  Object.freeze({
    name: 'preview',
    maxEdge: 1600,
    format: 'webp',
    mimeType: 'image/webp',
    quality: 82,
    always: false,
  }),
] as const);

/**
 * Metadata policy. EXIF, XMP, IPTC and any embedded GPS location are removed from every derived
 * image: an inventory photograph taken at home must not publish where that home is. Orientation
 * is the one exception - it is applied to the pixels and then dropped, so the stored variant is
 * upright without carrying the tag that described it. `webp-metadata.ts` enforces the removal on
 * the container bytes, because the pinned libvips ignores its own `strip` option for WebP.
 */
export const metadataPolicy = Object.freeze({
  stripAllMetadata: true,
  applyExifOrientation: true,
  /** Source fields that may be recorded technically; everything else is discarded. */
  retainedTechnicalFields: Object.freeze(['width', 'height', 'bands', 'loader'] as const),
  /** Never recorded, never logged, never returned by the API. */
  forbiddenFields: Object.freeze([
    'gps',
    'exif',
    'xmp',
    'iptc',
    'photoshop',
    'make',
    'model',
    'serial',
    'software',
    'datetime',
    'artist',
    'copyright',
    'usercomment',
  ] as const),
});

/**
 * Which variants an image of this size deserves. A variant that would only upscale the source is
 * not produced, so a small image never costs three near-identical objects.
 */
export function plannedVariants(
  sourceWidth: number,
  sourceHeight: number,
  plan: readonly VariantDefinition[] = variantPlan,
): VariantDefinition[] {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  return plan.filter((variant) => variant.always || variant.maxEdge < longestEdge);
}

/**
 * Variants live beside their source under a deterministic key, so a reprocessed asset overwrites
 * its own objects instead of leaking a new set on every attempt.
 */
export function variantStorageKey(
  assetId: string,
  variant: VariantName,
  extension = 'webp',
): string {
  const flat = assetId.replaceAll('-', '');
  return `assets/${flat.slice(0, 2)}/${flat.slice(2, 4)}/${flat}-${variant}.${extension}`;
}

/** EXIF orientation values 5-8 describe a quarter turn, so the stored dimensions swap. */
export function orientedDimensions(
  width: number,
  height: number,
  orientation: number | null,
): { width: number; height: number } {
  return orientation !== null && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

/** Rejects a metadata key the policy forbids, whatever casing or prefix a decoder reported. */
export function isForbiddenMetadataField(field: string): boolean {
  const normalized = field.toLowerCase();
  return metadataPolicy.forbiddenFields.some((forbidden) => normalized.includes(forbidden));
}
