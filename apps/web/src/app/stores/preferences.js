import { defineStore } from 'pinia';
import { ref } from 'vue';
export const usePreferencesStore = defineStore('preferences', () => {
  const locale = ref('en');
  return { locale };
});
