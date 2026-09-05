<script setup>
import InputNumber from 'primevue/inputnumber';
defineOptions({ inheritAttrs: false });
defineProps({ currency: { type: String, default: 'USD' }, disabled: Boolean, invalid: Boolean });
const model = defineModel({ type: Number, default: null });
</script>
<template>
  <InputNumber
    v-model="model"
    mode="currency"
    :currency="currency"
    :disabled="disabled"
    :invalid="invalid"
    v-bind="$attrs"
  />
</template>
