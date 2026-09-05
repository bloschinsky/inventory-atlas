<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>
<template>
  <section>
    <h1>{{ t('routes.error') }}</h1>
    <p>{{ t('foundation.error') }}</p>
  </section>
</template>
