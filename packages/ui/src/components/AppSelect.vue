<script setup>
import Select from 'primevue/select';
defineOptions({ inheritAttrs: false });
defineProps({
  inputId: { type: String, default: undefined },
  options: { type: Array, default: () => [] },
  disabled: Boolean,
  invalid: Boolean,
});
const model = defineModel({ type: [String, Number, Object, Array, Boolean], default: null });
</script>
<template>
  <Select
    v-model="model"
    :input-id="inputId"
    :options="options"
    :disabled="disabled"
    :invalid="invalid"
    v-bind="$attrs"
    ><template #option="slotProps"><slot name="option" v-bind="slotProps" /></template
  ></Select>
</template>
