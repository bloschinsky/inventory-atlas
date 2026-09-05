<script setup>
import DataTable from 'primevue/datatable';
defineOptions({ inheritAttrs: false });
defineProps({
  rows: { type: Array, default: () => [] },
  loading: Boolean,
  error: { type: String, default: '' },
});
defineEmits(['rowSelect']);
</script>
<template>
  <div v-if="error" role="alert">
    <slot name="error">{{ error }}</slot>
  </div>
  <DataTable
    v-else
    :value="rows"
    :loading="loading"
    v-bind="$attrs"
    @row-select="$emit('rowSelect', $event)"
  >
    <slot /><template #empty><slot name="empty" /></template
    ><template #loading><slot name="loading" /></template>
  </DataTable>
</template>
