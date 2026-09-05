<script setup>
import Button from 'primevue/button';
defineOptions({ inheritAttrs: false });
const props = defineProps({
  disabled: Boolean,
  loading: Boolean,
  variant: { type: String, default: 'primary' },
});
const emit = defineEmits(['click']);
/** @type {Record<string, string | undefined>} */
const severity = { primary: undefined, secondary: 'secondary', danger: 'danger' };
</script>
<template>
  <Button
    :disabled="props.disabled"
    :loading="props.loading"
    :severity="severity[props.variant]"
    v-bind="$attrs"
    @click="emit('click', $event)"
    ><slot
  /></Button>
</template>
