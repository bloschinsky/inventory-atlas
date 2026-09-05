import { describe, expect, it } from 'vitest';
import { defaultLocale, messages } from './index.js';

describe('i18n package', () => {
  it('provides English and Ukrainian resources', () => {
    expect(defaultLocale).toBe('en');
    expect(Object.keys(messages)).toEqual(['en', 'uk']);
  });
});
