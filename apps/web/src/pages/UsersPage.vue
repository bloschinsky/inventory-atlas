<script setup>
import { computed, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { AppButton, AppField, AppFormSection, AppInput, AppSelect } from '../shared/ui/index.js';
import {
  authKeys,
  issueInvitation,
  listInvitations,
  listUsers,
  revokeInvitation,
  updateUser,
} from '../features/auth/api.js';
import { useSessionContext } from '../shared/auth/session-context.js';
const { t } = useI18n();
const queryClient = useQueryClient();
const session = useSessionContext();
const users = useQuery({ queryKey: authKeys.users, queryFn: listUsers });
const invitations = useQuery({ queryKey: authKeys.invitations, queryFn: listInvitations });
const email = ref('');
const role = ref('viewer');
const issuedToken = ref('');
const error = ref('');
const roleOptions = computed(() =>
  session.summary?.role === 'owner'
    ? ['viewer', 'editor', 'admin', 'owner']
    : ['viewer', 'editor', 'admin'],
);
/** @param {{ email: string, role: string }} input */
function issueOne(input) {
  return issueInvitation(input, session.summary?.csrfToken ?? '');
}
/** @param {{ user: { id: string, version: number }, nextRole: string, ownerConfirmation: boolean }} input */
function changeOne({ user, nextRole, ownerConfirmation }) {
  return updateUser(
    user.id,
    { expectedVersion: user.version, role: nextRole, ownerConfirmation },
    session.summary?.csrfToken ?? '',
  );
}
/** @param {{ id: string, version: number }} item */
function revokeOne(item) {
  return revokeInvitation(item.id, item.version, session.summary?.csrfToken ?? '');
}
const invite = useMutation({
  mutationFn: issueOne,
  onSuccess: async (value) => {
    issuedToken.value = value.token;
    email.value = '';
    await queryClient.invalidateQueries({ queryKey: authKeys.invitations });
  },
  onError: () => {
    error.value = t('common.saveFailed');
  },
});
const change = useMutation({
  mutationFn: changeOne,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.users }),
});
const revoke = useMutation({
  mutationFn: revokeOne,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.invitations }),
});
function submitInvite() {
  error.value = '';
  invite.mutate({ email: email.value, role: role.value });
}
/** @param {{ id: string, version: number, role: string }} user @param {string} nextRole */
function setRole(user, nextRole) {
  const confirmed = user.role !== 'owner' || window.confirm(t('auth.confirmOwnerChange'));
  if (confirmed) change.mutate({ user, nextRole, ownerConfirmation: confirmed });
}
</script>
<template>
  <section>
    <h1>{{ t('routes.adminUsers') }}</h1>
    <AppFormSection :title="t('auth.inviteUser')"
      ><form class="inline-form" @submit.prevent="submitInvite">
        <AppField input-id="invitation-email" :label="t('auth.email')"
          ><AppInput id="invitation-email" v-model="email" type="email" required /></AppField
        ><AppField input-id="invitation-role" :label="t('auth.role')"
          ><AppSelect v-model="role" input-id="invitation-role" :options="roleOptions" /></AppField
        ><AppButton type="submit" :loading="invite.isPending.value">{{
          t('auth.issueInvitation')
        }}</AppButton>
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="issuedToken" class="token-result">
        <strong>{{ t('auth.copyTokenNow') }}</strong
        ><code>{{ issuedToken }}</code>
      </p></AppFormSection
    >
    <AppFormSection :title="t('auth.users')"
      ><p v-if="users.isLoading.value">{{ t('common.loading') }}</p>
      <ul v-else class="record-list">
        <li v-for="user in users.data.value ?? []" :key="user.id">
          <div>
            <strong>{{ user.displayName }}</strong>
            <small class="record-meta">{{ user.email }} · {{ user.status }}</small>
          </div>
          <AppSelect
            :model-value="user.role"
            :options="roleOptions"
            :disabled="
              change.isPending.value || (user.role === 'owner' && session.summary?.role !== 'owner')
            "
            @update:model-value="setRole(user, $event)"
          />
        </li></ul
    ></AppFormSection>
    <AppFormSection :title="t('auth.pendingInvitations')"
      ><ul class="record-list">
        <li v-for="item in invitations.data.value ?? []" :key="item.id">
          <div>
            <strong>{{ item.email }}</strong>
            <small class="record-meta">
              {{ item.role }} · {{ new Date(item.expiresAt).toLocaleString() }}
            </small>
          </div>
          <AppButton
            v-if="!item.acceptedAt && !item.revokedAt"
            variant="danger"
            @click="revoke.mutate(item)"
            >{{ t('auth.revoke') }}</AppButton
          >
        </li>
      </ul></AppFormSection
    >
  </section>
</template>
