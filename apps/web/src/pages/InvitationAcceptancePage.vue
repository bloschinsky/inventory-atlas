<script setup>
import { ref } from 'vue';
import { useMutation } from '@tanstack/vue-query';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { AppButton, AppField, AppFormSection, AppInput, AppSelect } from '../shared/ui/index.js';
import { acceptInvitation } from '../features/auth/api.js';
const { locale: activeLocale, t } = useI18n();
const route = useRoute();
const router = useRouter();
const token = ref(typeof route.query.token === 'string' ? route.query.token : '');
const displayName = ref('');
const password = ref('');
const locale = ref(activeLocale.value);
const localeOptions = [
  { value: 'en', labelKey: 'locale.en' },
  { value: 'uk', labelKey: 'locale.uk' },
];
const error = ref('');
const mutation = useMutation({
  mutationFn: acceptInvitation,
  onSuccess: () => router.push('/auth/sign-in'),
  onError: () => {
    error.value = t('auth.invitationInvalid');
  },
});
function submit() {
  error.value = '';
  mutation.mutate({
    token: token.value,
    displayName: displayName.value,
    password: password.value,
    locale: locale.value,
  });
}
</script>
<template>
  <section class="auth-panel">
    <h1>{{ t('auth.acceptInvitation') }}</h1>
    <AppFormSection :title="t('auth.account')"
      ><form class="stack" @submit.prevent="submit">
        <AppField input-id="invite-token" :label="t('auth.invitationToken')"
          ><AppInput id="invite-token" v-model="token" required
        /></AppField>
        <AppField input-id="invite-name" :label="t('auth.displayName')"
          ><AppInput id="invite-name" v-model="displayName" autocomplete="name" required
        /></AppField>
        <AppField input-id="invite-password" :label="t('auth.password')"
          ><AppInput
            id="invite-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
        /></AppField>
        <AppField input-id="invite-locale" :label="t('auth.locale')"
          ><AppSelect
            v-model="locale"
            input-id="invite-locale"
            :options="localeOptions.map((option) => ({ ...option, label: t(option.labelKey) }))"
            option-label="label"
            option-value="value"
        /></AppField>
        <p v-if="error" role="alert">{{ error }}</p>
        <AppButton type="submit" :loading="mutation.isPending.value">{{
          t('auth.createAccount')
        }}</AppButton>
      </form></AppFormSection
    >
  </section>
</template>
