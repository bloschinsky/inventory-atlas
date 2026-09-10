<script setup>
import MultiSelect from 'primevue/multiselect';
defineOptions({ inheritAttrs: false });
defineProps({
  inputId: { type: String, default: undefined },
  options: { type: Array, default: () => [] },
  disabled: Boolean,
  invalid: Boolean,
});
const model = defineModel({ type: Array, default: () => [] });
</script>
<template>
  <MultiSelect
    v-model="model"
    :input-id="inputId"
    :options="options"
    :disabled="disabled"
    :invalid="invalid"
    v-bind="$attrs"
    ><template #option="slotProps"><slot name="option" v-bind="slotProps" /></template
  ></MultiSelect>
</template>
