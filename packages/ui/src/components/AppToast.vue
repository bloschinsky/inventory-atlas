<script setup>
import Toast from 'primevue/toast';
import { computed } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps({ position: { type: String, default: 'top-right' } });
const toastPosition = computed(
  () =>
    /** @type {'top-right' | 'top-left' | 'top-center' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center'} */ (
      props.position
    ),
);
</script>
<template>
  <Toast :position="toastPosition" v-bind="$attrs"
    ><template #message="slotProps"><slot name="message" v-bind="slotProps" /></template
  ></Toast>
</template>
