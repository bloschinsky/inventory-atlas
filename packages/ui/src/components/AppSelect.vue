<script setup>
import Select from 'primevue/select';
defineOptions({ inheritAttrs: false });
defineProps({ options: { type: Array, default: () => [] }, disabled: Boolean, invalid: Boolean });
const model = defineModel({ type: [String, Number, Object, Array, Boolean], default: null });
</script>
<template>
  <Select v-model="model" :options="options" :disabled="disabled" :invalid="invalid" v-bind="$attrs"
    ><template #option="slotProps"><slot name="option" v-bind="slotProps" /></template
  ></Select>
</template>
