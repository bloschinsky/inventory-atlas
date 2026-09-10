<script setup>
import DatePicker from 'primevue/datepicker';
defineOptions({ inheritAttrs: false });
defineProps({ inputId: { type: String, default: undefined }, disabled: Boolean, invalid: Boolean });
const model = defineModel({
  type: /** @type {import('vue').PropType<Date|null>} */ (Date),
  default: null,
});
</script>
<template>
  <DatePicker
    v-model="model"
    :input-id="inputId"
    :disabled="disabled"
    :invalid="invalid"
    v-bind="$attrs"
  />
</template>
