import { describe, expect, it } from 'vitest';
import {
  defaultLocale,
  fallbackLocale,
  numberFormats,
  messages,
  normalizeLocale,
  resolveLocale,
  suggestLocale,
  supportedLocales,
} from './index.js';

describe('i18n package', () => {
  it('provides English and Ukrainian resources', () => {
    expect(defaultLocale).toBe('en');
    expect(fallbackLocale).toBe('en');
    expect(supportedLocales).toEqual(['en', 'uk']);
    expect(Object.keys(messages)).toEqual(['en', 'uk']);
  });

  it('resolves explicit choice, stored preference, then English', () => {
    expect(resolveLocale({ explicitLocale: 'uk', storedLocale: 'en' })).toBe('uk');
    expect(resolveLocale({ explicitLocale: 'de', storedLocale: 'uk-UA' })).toBe('uk');
    expect(resolveLocale({ storedLocale: 'de' })).toBe('en');
    expect(normalizeLocale('UK_ua')).toBe('uk');
  });

  it('suggests Ukrainian without including the browser in locale resolution', () => {
    expect(suggestLocale(['uk-UA', 'en-US'])).toBe('uk');
    expect(resolveLocale()).toBe('en');
    expect(suggestLocale(['de-DE', 'en'])).toBeNull();
  });

  it('provides locale-aware number formats for both supported locales', () => {
    expect(new Intl.NumberFormat('en-US', numberFormats.en.decimal).format(1234.5)).toBe('1,234.5');
    expect(new Intl.NumberFormat('uk-UA', numberFormats.uk.decimal).format(1234.5)).toContain(
      '234,5',
    );
  });
});
