<script setup>
import Fieldset from 'primevue/fieldset';
defineOptions({ inheritAttrs: false });
defineProps({ title: { type: String, required: true }, disabled: Boolean });
</script>
<template>
  <Fieldset :legend="title" :class="{ 'ia-disabled': disabled }" v-bind="$attrs"><slot /></Fieldset>
</template>
