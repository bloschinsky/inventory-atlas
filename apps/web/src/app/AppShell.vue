<script setup>
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import PublicLayout from './layouts/PublicLayout.vue';
import AuthenticatedLayout from './layouts/AuthenticatedLayout.vue';
const { t } = useI18n();
const route = useRoute();
const layout = computed(() =>
  route.meta.layout === 'public' ? PublicLayout : AuthenticatedLayout,
);
const links = [
  { to: '/items', key: 'nav.items' },
  { to: '/storage', key: 'nav.storage' },
  { to: '/scan', key: 'nav.scan' },
  { to: '/labels', key: 'nav.labels' },
  { to: '/portability', key: 'nav.portability' },
  { to: '/admin/settings', key: 'nav.admin' },
];
</script>
<template>
  <a class="skip-link" href="#main-content">{{ t('app.skipToContent') }}</a>
  <header class="app-header">
    <RouterLink class="brand" to="/">{{ t('app.name') }}</RouterLink>
    <nav :aria-label="t('app.navigation')">
      <RouterLink v-for="link in links" :key="link.to" :to="link.to">{{ t(link.key) }}</RouterLink>
    </nav>
  </header>
  <main id="main-content" class="app-main" tabindex="-1">
    <component :is="layout"><slot /></component>
  </main>
</template>
