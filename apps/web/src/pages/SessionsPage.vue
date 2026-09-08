<script setup>
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { AppButton } from '../shared/ui/index.js';
import { authKeys, listSessions, revokeSession } from '../features/auth/api.js';
import { useSessionContext } from '../shared/auth/session-context.js';
const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();
const session = useSessionContext();
const query = useQuery({ queryKey: authKeys.sessions, queryFn: listSessions });
/** @param {string} id */
function revokeOne(id) {
  return revokeSession(id, session.summary?.csrfToken ?? '');
}
const revoke = useMutation({
  mutationFn: revokeOne,
  onSuccess: async (_, id) => {
    if (id === session.summary?.id) {
      session.clear();
      await router.push('/auth/sign-in');
    } else await queryClient.invalidateQueries({ queryKey: authKeys.sessions });
  },
});
</script>
<template>
  <section>
    <h1>{{ t('auth.sessions') }}</h1>
    <p v-if="query.isLoading.value">{{ t('common.loading') }}</p>
    <p v-else-if="query.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
    <ul v-else class="record-list">
      <li v-for="item in query.data.value ?? []" :key="item.id">
        <div>
          <strong>{{
            item.current
              ? t('auth.currentSession')
              : item.userAgentSummary || t('auth.unknownDevice')
          }}</strong>
          <small class="record-meta">{{ new Date(item.lastSeenAt).toLocaleString() }}</small>
        </div>
        <AppButton
          variant="danger"
          :loading="revoke.isPending.value"
          @click="revoke.mutate(item.id)"
          >{{ t('auth.revoke') }}</AppButton
        >
      </li>
    </ul>
  </section>
</template>
