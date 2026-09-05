<script setup>
import FileUpload from 'primevue/fileupload';
defineOptions({ inheritAttrs: false });
defineProps({ accept: { type: String, default: undefined }, disabled: Boolean, loading: Boolean });
defineEmits(['select', 'remove']);
</script>
<template>
  <FileUpload
    :accept="accept"
    :disabled="disabled || loading"
    v-bind="$attrs"
    @select="$emit('select', $event)"
    @remove="$emit('remove', $event)"
    ><template #empty><slot name="empty" /></template
  ></FileUpload>
</template>
