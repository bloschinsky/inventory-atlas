<script setup>
import { onErrorCaptured, ref } from 'vue';
const failed = ref(false);
onErrorCaptured(() => {
  failed.value = true;
  return false;
});
</script>
<template>
  <main v-if="failed" id="main-content" tabindex="-1"><slot name="error" /></main>
  <slot v-else />
</template>
