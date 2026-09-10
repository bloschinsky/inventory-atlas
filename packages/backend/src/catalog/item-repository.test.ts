import { describe, expect, it } from 'vitest';
import { itemSlug, normalizeItemVisibility, normalizeTagName } from './item-repository.js';

describe('Item identity and normalization', () => {
  it('creates a bounded URL-safe decorative slug', () => {
    expect(itemSlug('  Café Router / Main  ', '10000000-0000-4000-8000-000000000001')).toBe(
      'cafe-router-main',
    );
    expect(itemSlug('Маршрутизатор', '10000000-0000-4000-8000-000000000001')).toBe(
      'item-100000000000',
    );
  });

  it('normalizes tag whitespace and case', () => {
    expect(normalizeTagName('  Spare   Parts ')).toBe('spare parts');
    expect(() => normalizeTagName('   ')).toThrow('Tag name is required.');
  });

  it('accepts only approved Item visibility values', () => {
    expect(normalizeItemVisibility(undefined)).toBe('authenticated');
    expect(normalizeItemVisibility('unlisted')).toBe('unlisted');
    expect(() => normalizeItemVisibility('viewer')).toThrow('Item visibility is invalid.');
  });
});
