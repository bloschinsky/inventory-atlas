import { describe, expect, it } from 'vitest';
import { defaultLocale, supportedLocales } from './index.js';

describe('shared configuration', () => {
  it('uses English as the default locale', () => {
    expect(defaultLocale).toBe('en');
    expect(supportedLocales).toContain('uk');
  });
});
