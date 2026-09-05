<script setup>
import Paginator from 'primevue/paginator';
defineOptions({ inheritAttrs: false });
defineProps({
  rows: { type: Number, required: true },
  totalRecords: { type: Number, required: true },
  disabled: Boolean,
});
const first = defineModel('first', { type: Number, default: 0 });
</script>
<template>
  <Paginator
    v-model:first="first"
    :rows="rows"
    :total-records="totalRecords"
    :class="{ 'ia-disabled': disabled }"
    v-bind="$attrs"
  />
</template>
