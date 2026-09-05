<script setup>
defineProps({
  label: { type: String, required: true },
  error: { type: String, default: '' },
  inputId: { type: String, required: true },
});
</script>
<template>
  <div class="ia-field">
    <label :for="inputId">{{ label }}</label
    ><slot />
    <small v-if="error" class="ia-field__error" role="alert">{{ error }}</small>
  </div>
</template>
<style scoped>
.ia-field {
  display: grid;
  gap: var(--ia-space-2);
}
.ia-field__error {
  color: var(--ia-color-danger);
}
</style>
