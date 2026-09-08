import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useSessionStore = defineStore('session', () => {
  const summary = ref(
    /** @type {{ id: string, displayName: string, locale: string, role: string, permissions: string[], csrfToken: string } | null} */ (
      null
    ),
  );
  /** @param {{ actor: { id: string, displayName: string, locale: string, role: string, permissions: string[] }, csrfToken: string }} value */
  function set(value) {
    summary.value = { ...value.actor, csrfToken: value.csrfToken };
  }
  function clear() {
    summary.value = null;
  }
  /** @param {string} locale */
  function setLocale(locale) {
    if (summary.value) summary.value = { ...summary.value, locale };
  }
  return { summary, set, clear, setLocale };
});
