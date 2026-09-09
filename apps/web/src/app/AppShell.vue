<script setup>
import { useI18n } from 'vue-i18n';
import { computed, provide, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { AppButton, AppSelect } from '../shared/ui/index.js';
import { authKeys, getCurrentSession, signOut, updateCurrentLocale } from '../features/auth/api.js';
import { useSessionStore } from './stores/session.js';
import { usePreferencesStore } from './stores/preferences.js';
import { sessionContextKey } from '../shared/auth/session-context.js';
import { applyDocumentLocale } from '../shared/i18n/index.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';
import { RouterLink, useRoute } from 'vue-router';
import PublicLayout from './layouts/PublicLayout.vue';
import AuthenticatedLayout from './layouts/AuthenticatedLayout.vue';
const { locale, t } = useI18n();
const route = useRoute();
const session = useSessionStore();
const preferences = usePreferencesStore();
const localeError = ref('');
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
watch(
  () => session.summary?.locale,
  (value) => {
    if (value) preferences.restoreAuthenticatedLocale(value);
  },
);
watch(
  () => preferences.locale,
  (value) => {
    locale.value = value;
    applyDocumentLocale(value);
  },
  { immediate: true },
);
const signOutMutation = useMutation({
  mutationFn: () => signOut(session.summary?.csrfToken ?? ''),
  onSettled: () => {
    session.clear();
    queryClient.removeQueries({ queryKey: authKeys.current });
  },
});
/** @param {{ nextLocale: string, previousLocale: string }} input */
function persistLocale(input) {
  return updateCurrentLocale(input.nextLocale, session.summary?.csrfToken ?? '');
}
const localeMutation = useMutation({
  mutationFn: persistLocale,
  onSuccess: (actor) => {
    session.setLocale(actor.locale);
    void queryClient.invalidateQueries({ queryKey: authKeys.current });
  },
  onError: (error, input) => {
    preferences.selectLocale(input.previousLocale);
    localeError.value = t(problemMessageKey(error));
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
  { to: '/admin/categories', key: 'nav.admin' },
];
const localeOptions = computed(() =>
  ['en', 'uk'].map((value) => ({
    value,
    label:
      value === preferences.browserLocaleSuggestion && value !== preferences.locale
        ? `${t(`locale.${value}`)} (${t('locale.suggested')})`
        : t(`locale.${value}`),
  })),
);
/** @param {string} nextLocale */
function selectLocale(nextLocale) {
  localeError.value = '';
  const previousLocale = preferences.locale;
  preferences.selectLocale(nextLocale);
  if (session.summary && session.summary.locale !== preferences.locale) {
    localeMutation.mutate({ nextLocale: preferences.locale, previousLocale });
  }
}
</script>
<template>
  <a class="skip-link" href="#main-content">{{ t('app.skipToContent') }}</a>
  <header class="app-header">
    <RouterLink class="brand" to="/">{{ t('app.name') }}</RouterLink>
    <nav :aria-label="t('app.navigation')">
      <RouterLink v-for="link in links" :key="link.to" :to="link.to">{{ t(link.key) }}</RouterLink>
    </nav>
    <div class="session-actions">
      <label class="visually-hidden" for="application-locale">{{
        t('app.languageSelector')
      }}</label>
      <AppSelect
        input-id="application-locale"
        data-testid="locale-selector"
        :aria-label="t('app.languageSelector')"
        :model-value="preferences.locale"
        :options="localeOptions"
        option-label="label"
        option-value="value"
        :disabled="localeMutation.isPending.value"
        @update:model-value="selectLocale"
      />
      <span v-if="localeError" class="locale-error" role="alert">{{ localeError }}</span>
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
