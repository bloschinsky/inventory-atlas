import { describe, expect, it } from 'vitest';
import {
  isForbiddenMetadataField,
  metadataPolicy,
  orientedDimensions,
  plannedVariants,
  variantNames,
  variantPlan,
  variantStorageKey,
} from './image-variants.js';

describe('variant plan', () => {
  it('defines one WebP delivery format ordered from smallest to largest', () => {
    expect(variantPlan.map((variant) => variant.name)).toEqual([...variantNames]);
    expect(variantPlan.every((variant) => variant.mimeType === 'image/webp')).toBe(true);
    const edges = variantPlan.map((variant) => variant.maxEdge);
    expect([...edges].sort((a, b) => a - b)).toEqual(edges);
  });

  it('keeps every variant inside a sane quality band', () => {
    for (const variant of variantPlan) {
      expect(variant.quality).toBeGreaterThanOrEqual(70);
      expect(variant.quality).toBeLessThanOrEqual(90);
    }
  });

  it('always produces a thumbnail, even for an image smaller than the thumbnail', () => {
    expect(plannedVariants(16, 16).map((variant) => variant.name)).toEqual(['thumb']);
  });

  it('never plans a variant that would only upscale the source', () => {
    expect(plannedVariants(900, 600).map((variant) => variant.name)).toEqual(['thumb', 'card']);
    expect(plannedVariants(4_000, 3_000).map((variant) => variant.name)).toEqual([
      'thumb',
      'card',
      'preview',
    ]);
  });
});

describe('variant keys', () => {
  it('derives a deterministic key beside the source, so reprocessing overwrites itself', () => {
    const assetId = '0f9c2f1a-1b2c-4d5e-8f90-112233445566';
    expect(variantStorageKey(assetId, 'thumb')).toBe(
      'assets/0f/9c/0f9c2f1a1b2c4d5e8f90112233445566-thumb.webp',
    );
    expect(variantStorageKey(assetId, 'thumb')).toBe(variantStorageKey(assetId, 'thumb'));
    expect(variantStorageKey(assetId, 'card')).not.toBe(variantStorageKey(assetId, 'thumb'));
  });
});

describe('metadata policy', () => {
  it('strips everything and applies orientation to the pixels instead', () => {
    expect(metadataPolicy.stripAllMetadata).toBe(true);
    expect(metadataPolicy.applyExifOrientation).toBe(true);
  });

  it('refuses location and camera identity fields whatever the decoder calls them', () => {
    for (const field of [
      'exif-ifd3-GPSLatitude',
      'GPS-Longitude',
      'exif-ifd0-Make',
      'xmp-data',
      'iptc-data',
      'exif-ifd0-Artist',
    ])
      expect(isForbiddenMetadataField(field)).toBe(true);
    for (const field of metadataPolicy.retainedTechnicalFields)
      expect(isForbiddenMetadataField(field)).toBe(false);
  });
});

describe('orientation', () => {
  it('swaps dimensions only for the quarter-turn values', () => {
    for (const orientation of [5, 6, 7, 8])
      expect(orientedDimensions(4, 3, orientation)).toEqual({ width: 3, height: 4 });
    for (const orientation of [1, 2, 3, 4, null])
      expect(orientedDimensions(4, 3, orientation)).toEqual({ width: 4, height: 3 });
  });
});
