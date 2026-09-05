<script setup>
import InputText from 'primevue/inputtext';
defineOptions({ inheritAttrs: false });
defineProps({
  disabled: Boolean,
  invalid: Boolean,
  describedBy: { type: String, default: undefined },
});
const model = defineModel({ type: String, default: '' });
</script>
<template>
  <InputText
    v-model="model"
    :disabled="disabled"
    :invalid="invalid"
    :aria-describedby="describedBy"
    v-bind="$attrs"
  />
</template>
