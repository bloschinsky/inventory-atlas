<script setup>
import DatePicker from 'primevue/datepicker';
defineOptions({ inheritAttrs: false });
defineProps({ disabled: Boolean, invalid: Boolean });
const model = defineModel({ default: null });
</script>
<template>
  <DatePicker v-model="model" :disabled="disabled" :invalid="invalid" v-bind="$attrs" />
</template>
