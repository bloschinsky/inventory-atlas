import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useNavigationStore = defineStore('navigation', () => {
  const drawerOpen = ref(false);
  return { drawerOpen };
});
