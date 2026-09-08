import { defineStore } from 'pinia';
import { ref } from 'vue';
import { resolveLocale, suggestLocale } from '@inventory-atlas/i18n';
import { initialLocale, writeStoredLocale } from '../../shared/i18n/index.js';

export const usePreferencesStore = defineStore('preferences', () => {
  const locale = ref(initialLocale);
  const browserLocaleSuggestion = ref(
    suggestLocale(globalThis.navigator?.languages ?? [globalThis.navigator?.language]),
  );

  /** @param {unknown} value */
  function selectLocale(value) {
    locale.value = resolveLocale({ explicitLocale: value, storedLocale: locale.value });
    writeStoredLocale(locale.value);
  }

  /** @param {unknown} value */
  function restoreAuthenticatedLocale(value) {
    locale.value = resolveLocale({ storedLocale: value });
    writeStoredLocale(locale.value);
  }

  return { browserLocaleSuggestion, locale, restoreAuthenticatedLocale, selectLocale };
});
