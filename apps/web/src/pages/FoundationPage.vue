<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
const route = useRoute();
const { t } = useI18n();
const title = computed(() => t(String(route.meta.titleKey)));
</script>
<template>
  <section>
    <h1>{{ title }}</h1>
    <p>{{ t('foundation.pending') }}</p>
  </section>
</template>
