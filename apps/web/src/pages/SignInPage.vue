<script setup>
import { ref } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { AppButton, AppField, AppFormSection, AppInput } from '../shared/ui/index.js';
import { authKeys, signIn } from '../features/auth/api.js';
import { useSessionContext } from '../shared/auth/session-context.js';

const { t } = useI18n();
const router = useRouter();
const queryClient = useQueryClient();
const session = useSessionContext();
const email = ref('');
const password = ref('');
const error = ref('');
const mutation = useMutation({
  mutationFn: signIn,
  onSuccess: async (value) => {
    session.set(value);
    queryClient.setQueryData(authKeys.current, value);
    await router.push('/items');
  },
  onError: () => {
    error.value = t('auth.signInFailed');
  },
});
function submit() {
  error.value = '';
  mutation.mutate({ email: email.value, password: password.value });
}
</script>
<template>
  <section class="auth-panel">
    <h1>{{ t('auth.signIn') }}</h1>
    <AppFormSection :title="t('auth.account')">
      <form class="stack" @submit.prevent="submit">
        <AppField input-id="sign-in-email" :label="t('auth.email')"
          ><AppInput id="sign-in-email" v-model="email" type="email" autocomplete="email" required
        /></AppField>
        <AppField input-id="sign-in-password" :label="t('auth.password')"
          ><AppInput
            id="sign-in-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
        /></AppField>
        <p v-if="error" role="alert">{{ error }}</p>
        <AppButton type="submit" :loading="mutation.isPending.value">{{
          t('auth.signIn')
        }}</AppButton>
      </form>
    </AppFormSection>
  </section>
</template>
