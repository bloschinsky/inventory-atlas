import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useItemsStore = defineStore('items', () => ({ responseCache: ref([]) }));
