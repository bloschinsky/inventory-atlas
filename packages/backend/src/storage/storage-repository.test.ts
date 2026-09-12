import { describe, expect, it } from 'vitest';
import {
  normalizeStorageType,
  normalizeStorageVisibility,
  storageNodeLabel,
} from './storage-repository.js';

describe('StorageNode policy', () => {
  it('encodes the frozen lowercase UUID-hex ltree label', () => {
    expect(storageNodeLabel('0198F40C-92F3-7A12-BC9A-653F97786C2B')).toBe(
      'n0198f40c92f37a12bc9a653f97786c2b',
    );
  });

  it('rejects unsupported types and visibility values', () => {
    expect(() => normalizeStorageType('drawer')).toThrowError(/type is invalid/u);
    expect(() => normalizeStorageVisibility('secret')).toThrowError(/visibility is invalid/u);
  });
});
