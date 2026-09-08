import { createI18n } from 'vue-i18n';
import {
  dateTimeFormats,
  fallbackLocale,
  messages,
  numberFormats,
  resolveLocale,
} from '@inventory-atlas/i18n';

export const localeStorageKey = 'inventory-atlas.locale';

export function readStoredLocale() {
  try {
    return globalThis.localStorage?.getItem(localeStorageKey) ?? null;
  } catch {
    return null;
  }
}

/** @param {string} locale */
export function writeStoredLocale(locale) {
  try {
    globalThis.localStorage?.setItem(localeStorageKey, locale);
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory choice still works.
  }
}

export const initialLocale = resolveLocale({ storedLocale: readStoredLocale() });
export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale,
  messages,
  datetimeFormats: dateTimeFormats,
  numberFormats,
});

/** @param {string} locale */
export function applyDocumentLocale(locale) {
  if (globalThis.document?.documentElement) globalThis.document.documentElement.lang = locale;
}
