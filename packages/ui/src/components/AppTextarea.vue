<script setup>
import Textarea from 'primevue/textarea';
defineOptions({ inheritAttrs: false });
defineProps({
  disabled: Boolean,
  invalid: Boolean,
  describedBy: { type: String, default: undefined },
});
const model = defineModel({ type: String, default: '' });
</script>
<template>
  <Textarea
    v-model="model"
    :disabled="disabled"
    :invalid="invalid"
    :aria-describedby="describedBy"
    v-bind="$attrs"
  />
</template>
