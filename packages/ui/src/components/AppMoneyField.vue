<script setup>
import InputNumber from 'primevue/inputnumber';
defineOptions({ inheritAttrs: false });
defineProps({
  inputId: { type: String, default: undefined },
  currency: { type: String, default: 'USD' },
  disabled: Boolean,
  invalid: Boolean,
});
const model = defineModel({ type: Number, default: null });
</script>
<template>
  <InputNumber
    v-model="model"
    :input-id="inputId"
    mode="currency"
    :currency="currency"
    :disabled="disabled"
    :invalid="invalid"
    v-bind="$attrs"
  />
</template>
