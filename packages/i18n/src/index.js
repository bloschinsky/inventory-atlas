import en from './locales/en.json' with { type: 'json' };
import uk from './locales/uk.json' with { type: 'json' };

export const defaultLocale = 'en';
export const fallbackLocale = 'en';
export const supportedLocales = Object.freeze(['en', 'uk']);
export const messages = { en, uk };

/** @type {Record<string, Record<string, Intl.DateTimeFormatOptions>>} */
export const dateTimeFormats = {
  en: { short: { dateStyle: 'medium', timeStyle: 'short' } },
  uk: { short: { dateStyle: 'medium', timeStyle: 'short' } },
};

/** @type {Record<string, Record<string, Intl.NumberFormatOptions>>} */
export const numberFormats = {
  en: { decimal: { maximumFractionDigits: 2 } },
  uk: { decimal: { maximumFractionDigits: 2 } },
};

/** @param {unknown} value */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const language = value.trim().toLowerCase().split(/[-_]/u)[0];
  return supportedLocales.includes(language) ? language : null;
}

/**
 * Explicit user intent always wins, followed by a persisted preference. The
 * browser locale is deliberately excluded from resolution by ADR-014.
 * @param {{ explicitLocale?: unknown, storedLocale?: unknown }} [input]
 */
export function resolveLocale(input = {}) {
  return (
    normalizeLocale(input.explicitLocale) ?? normalizeLocale(input.storedLocale) ?? defaultLocale
  );
}

/** @param {readonly unknown[]} [browserLanguages] */
export function suggestLocale(browserLanguages = []) {
  return browserLanguages.some((value) => normalizeLocale(value) === 'uk') ? 'uk' : null;
}
