<script setup>
import Menu from 'primevue/menu';
import { computed } from 'vue';
defineOptions({ inheritAttrs: false });
const props = defineProps({ items: { type: Array, default: () => [] } });
const menuItems = computed(
  () => /** @type {import('primevue/menuitem').MenuItem[]} */ (props.items),
);
</script>
<template>
  <Menu :model="menuItems" v-bind="$attrs"
    ><template #item="slotProps"><slot name="item" v-bind="slotProps" /></template
  ></Menu>
</template>
