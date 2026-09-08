import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useSessionStore = defineStore('session', () => {
  const summary = ref(
    /** @type {{ id: string, displayName: string, role: string, permissions: string[], csrfToken: string } | null} */ (
      null
    ),
  );
  /** @param {{ actor: { id: string, displayName: string, role: string, permissions: string[] }, csrfToken: string }} value */
  function set(value) {
    summary.value = { ...value.actor, csrfToken: value.csrfToken };
  }
  function clear() {
    summary.value = null;
  }
  return { summary, set, clear };
});
