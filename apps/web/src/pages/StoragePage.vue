<script setup>
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { AppButton, AppField, AppFormSection, AppInput, AppSelect } from '../shared/ui/index.js';
import { useSessionContext } from '../shared/auth/session-context.js';
import { listFieldDefinitions, schemaKeys } from '../features/schema/api.js';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import { isEmptyValue, serializeAttributes } from '../features/items/attribute-form.js';
import { createStorageNode, listStorageNodes, storageKeys } from '../features/storage/api.js';
import { fieldErrorsFromProblem } from '../shared/lib/form-errors.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const session = useSessionContext();
const queryClient = useQueryClient();
const canEdit = computed(() => session.summary?.permissions?.includes('editItems') ?? false);
const canViewPrivate = computed(
  () => session.summary?.permissions?.includes('viewPrivateFields') ?? false,
);
const parentPublicId = computed(() =>
  typeof route.query.parent === 'string' ? route.query.parent : null,
);
const form = reactive({ title: '', nodeType: 'container', code: '', visibility: 'authenticated' });
const attributes = reactive(/** @type {Record<string, unknown>} */ ({}));
const errors = reactive(/** @type {Record<string, string>} */ ({}));
const submitError = ref('');

const nodesQuery = useQuery({
  queryKey: computed(() => storageKeys.children(parentPublicId.value)),
  queryFn: () => listStorageNodes({ parentPublicId: parentPublicId.value }),
  enabled: computed(() => Boolean(session.summary)),
});
const fieldsQuery = useQuery({
  queryKey: schemaKeys.fieldsForScope('storage_node'),
  queryFn: () => listFieldDefinitions('storage_node', { includeArchived: false }),
  enabled: canEdit,
});
const definitions = computed(() =>
  /** @type {Record<string, any>[]} */ (fieldsQuery.data.value ?? []).filter(
    (definition) => definition.visibility !== 'private' || canViewPrivate.value,
  ),
);
const nodeTypeOptions = computed(() =>
  ['site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom'].map((value) => ({
    value,
    label: t(`storage.types.${value}`),
  })),
);
const visibilityOptions = computed(() =>
  ['public', 'authenticated', 'private', 'unlisted']
    .filter((value) => value !== 'private' || canViewPrivate.value)
    .map((value) => ({ value, label: t(`items.visibilities.${value}`) })),
);
const mutation = useMutation({
  mutationFn: () =>
    createStorageNode(
      {
        parentPublicId: parentPublicId.value,
        title: form.title.trim(),
        nodeType: form.nodeType,
        code: form.code.trim() || null,
        visibility: form.visibility,
        attributes: serializeAttributes(definitions.value, attributes),
      },
      session.summary?.csrfToken ?? '',
    ),
  onSuccess: async (node) => {
    await queryClient.invalidateQueries({ queryKey: storageKeys.all });
    await router.push(`/storage/${node.publicId}`);
  },
  onError: (error) => {
    Object.assign(
      errors,
      fieldErrorsFromProblem(
        error && typeof error === 'object' && 'detail' in error ? error.detail : null,
      ),
    );
    submitError.value = t(problemMessageKey(error));
  },
});

function submit() {
  for (const key of Object.keys(errors)) delete errors[key];
  if (!form.title.trim()) errors.title = t('validation.required');
  for (const definition of definitions.value)
    if (definition.required && isEmptyValue(attributes[definition.key]))
      errors[`attributes.${definition.key}`] = t('validation.required');
  if (!Object.keys(errors).length) mutation.mutate();
}
</script>

<template>
  <section class="storage-page stack">
    <div class="page-heading">
      <div>
        <h1>{{ parentPublicId ? t('storage.addChild') : t('routes.storage') }}</h1>
        <p>{{ t('storage.description') }}</p>
      </div>
      <RouterLink v-if="parentPublicId" to="/storage">{{ t('storage.backToRoots') }}</RouterLink>
    </div>

    <p v-if="nodesQuery.isLoading.value">{{ t('common.loading') }}</p>
    <p v-else-if="nodesQuery.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
    <ul v-else class="storage-list">
      <li v-for="node in nodesQuery.data.value?.entries ?? []" :key="node.publicId">
        <RouterLink :to="`/storage/${node.publicId}`">
          <strong>{{ node.title }}</strong>
          <span>{{ t(`storage.types.${node.nodeType}`) }}</span>
        </RouterLink>
      </li>
      <li v-if="!nodesQuery.data.value?.entries?.length">{{ t('storage.empty') }}</li>
    </ul>

    <form v-if="canEdit" class="storage-form" @submit.prevent="submit">
      <AppFormSection :title="parentPublicId ? t('storage.addChild') : t('storage.addRoot')">
        <div class="storage-grid">
          <AppField input-id="storage-title" :label="t('storage.title')" :error="errors.title">
            <AppInput id="storage-title" v-model="form.title" :invalid="Boolean(errors.title)" />
          </AppField>
          <AppField input-id="storage-type" :label="t('storage.type')">
            <AppSelect
              v-model="form.nodeType"
              input-id="storage-type"
              :options="nodeTypeOptions"
              option-label="label"
              option-value="value"
            />
          </AppField>
          <AppField input-id="storage-code" :label="t('storage.code')">
            <AppInput id="storage-code" v-model="form.code" maxlength="128" />
          </AppField>
          <AppField input-id="storage-visibility" :label="t('items.visibility')">
            <AppSelect
              v-model="form.visibility"
              input-id="storage-visibility"
              :options="visibilityOptions"
              option-label="label"
              option-value="value"
            />
          </AppField>
        </div>
        <div class="storage-grid">
          <ItemAttributeField
            v-for="definition in definitions"
            :key="definition.id"
            v-model="attributes[definition.key]"
            :definition="definition"
            :error="errors[`attributes.${definition.key}`]"
          />
        </div>
        <p v-if="submitError" role="alert">{{ submitError }}</p>
        <AppButton type="submit" :loading="mutation.isPending.value">{{
          t('common.create')
        }}</AppButton>
      </AppFormSection>
    </form>
  </section>
</template>

<style scoped>
.storage-list {
  display: grid;
  gap: var(--ia-space-2);
  padding: 0;
  list-style: none;
}
.storage-list a {
  display: flex;
  justify-content: space-between;
  gap: var(--ia-space-3);
  min-height: var(--ia-control-min-height);
  padding: var(--ia-space-3);
  border: 1px solid var(--ia-color-border);
  border-radius: var(--ia-radius-md);
  color: inherit;
  text-decoration: none;
}
.storage-list span {
  color: var(--ia-color-text-muted);
}
.storage-form,
.storage-grid {
  display: grid;
  gap: var(--ia-space-4);
}
.storage-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: var(--ia-space-4);
}
@media (max-width: 720px) {
  .storage-grid {
    grid-template-columns: 1fr;
  }
  .storage-list a {
    flex-direction: column;
  }
}
</style>
