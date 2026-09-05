<script setup>
import Dialog from 'primevue/dialog';
defineOptions({ inheritAttrs: false });
defineProps({ title: { type: String, required: true } });
const visible = defineModel('visible', { type: Boolean, default: false });
</script>
<template>
  <Dialog v-model:visible="visible" :header="title" modal v-bind="$attrs"
    ><slot /><template #footer><slot name="footer" /></template
  ></Dialog>
</template>
