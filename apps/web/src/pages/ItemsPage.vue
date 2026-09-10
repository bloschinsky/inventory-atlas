<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSessionContext } from '../shared/auth/session-context.js';

const { t } = useI18n();
const session = useSessionContext();
const canEdit = computed(() => session.summary?.permissions?.includes('editItems') ?? false);
</script>

<template>
  <section class="stack">
    <div class="page-heading">
      <div>
        <h1>{{ t('routes.items') }}</h1>
        <p>{{ t('items.listPending') }}</p>
      </div>
      <RouterLink v-if="canEdit" class="primary-link" to="/items/new">{{
        t('items.new')
      }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.primary-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--ia-control-min-height);
  padding: 0 var(--ia-space-4);
  border-radius: var(--ia-radius-md);
  background: var(--ia-color-brand-700);
  color: var(--ia-color-surface-0);
  text-decoration: none;
}
</style>
