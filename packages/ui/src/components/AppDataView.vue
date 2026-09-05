<script setup>
import DataView from 'primevue/dataview';
defineOptions({ inheritAttrs: false });
defineProps({
  items: { type: Array, default: () => [] },
  loading: Boolean,
  error: { type: String, default: '' },
});
</script>
<template>
  <div v-if="error" role="alert">
    <slot name="error">{{ error }}</slot>
  </div>
  <DataView v-else :value="items" :loading="loading" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </DataView>
</template>
