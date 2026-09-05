import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useSessionStore = defineStore('session', () => {
  const summary = ref(/** @type {{ role: string } | null} */ (null));
  function clear() {
    summary.value = null;
  }
  return { summary, clear };
});
