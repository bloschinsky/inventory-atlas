<script setup>
import DatePicker from 'primevue/datepicker';
defineOptions({ inheritAttrs: false });
defineProps({ disabled: Boolean, invalid: Boolean });
const model = defineModel({
  type: /** @type {import('vue').PropType<Date|null>} */ (Date),
  default: null,
});
</script>
<template>
  <DatePicker v-model="model" :disabled="disabled" :invalid="invalid" v-bind="$attrs" />
</template>
