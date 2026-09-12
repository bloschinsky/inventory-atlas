<script setup>
import Breadcrumb from 'primevue/breadcrumb';
import { computed } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps({
  items: { type: Array, default: () => [] },
  home: { type: Object, default: null },
});
const breadcrumbItems = computed(
  () => /** @type {import('primevue/menuitem').MenuItem[]} */ (props.items),
);
</script>
<template>
  <Breadcrumb :model="breadcrumbItems" :home="home" v-bind="$attrs">
    <template v-if="$slots.item" #item="slotProps">
      <slot name="item" v-bind="slotProps" />
    </template>
  </Breadcrumb>
</template>
