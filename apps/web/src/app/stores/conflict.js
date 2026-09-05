import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useConflictStore = defineStore('conflict', () => {
  const model = ref(/** @type {unknown} */ (null));
  /** @param {unknown} nextModel */
  function open(nextModel) {
    model.value = nextModel;
  }
  function close() {
    model.value = null;
  }
  return { model, open, close };
});
