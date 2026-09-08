<script setup>
import { useI18n } from 'vue-i18n';
import { computed, provide, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { AppButton } from '../shared/ui/index.js';
import { authKeys, getCurrentSession, signOut } from '../features/auth/api.js';
import { useSessionStore } from './stores/session.js';
import { sessionContextKey } from '../shared/auth/session-context.js';
import { RouterLink, useRoute } from 'vue-router';
import PublicLayout from './layouts/PublicLayout.vue';
import AuthenticatedLayout from './layouts/AuthenticatedLayout.vue';
const { t } = useI18n();
const route = useRoute();
const session = useSessionStore();
provide(sessionContextKey, session);
const queryClient = useQueryClient();
const currentSession = useQuery({
  queryKey: authKeys.current,
  queryFn: getCurrentSession,
  retry: false,
});
watch(currentSession.data, (value) => {
  if (value) session.set(value);
});
const signOutMutation = useMutation({
  mutationFn: () => signOut(session.summary?.csrfToken ?? ''),
  onSettled: () => {
    session.clear();
    queryClient.removeQueries({ queryKey: authKeys.current });
  },
});
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
    <div class="session-actions">
      <RouterLink v-if="session.summary" to="/account/sessions">{{
        session.summary.displayName
      }}</RouterLink>
      <AppButton v-if="session.summary" variant="secondary" @click="signOutMutation.mutate()">{{
        t('auth.signOut')
      }}</AppButton>
      <RouterLink v-else to="/auth/sign-in">{{ t('auth.signIn') }}</RouterLink>
    </div>
  </header>
  <main id="main-content" class="app-main" tabindex="-1">
    <component :is="layout"><slot /></component>
  </main>
</template>
