<script setup>
import Drawer from 'primevue/drawer';
defineOptions({ inheritAttrs: false });
defineProps({ title: { type: String, required: true } });
const visible = defineModel('visible', { type: Boolean, default: false });
</script>
<template>
  <Drawer v-model:visible="visible" :header="title" v-bind="$attrs"><slot /></Drawer>
</template>
