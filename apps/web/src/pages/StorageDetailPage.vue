<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AppBreadcrumb,
  AppButton,
  AppField,
  AppFormSection,
  AppInput,
  AppSelect,
} from '../shared/ui/index.js';
import { useSessionContext } from '../shared/auth/session-context.js';
import { getStorageNode, storageKeys, updateStorageNode } from '../features/storage/api.js';
import { listFieldDefinitions, schemaKeys } from '../features/schema/api.js';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import { draftFromStored, serializeAttributes } from '../features/items/attribute-form.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

const { t } = useI18n();
const route = useRoute();
const session = useSessionContext();
const queryClient = useQueryClient();
const publicId = computed(() => String(route.params.publicId));
const canEdit = computed(() => session.summary?.permissions?.includes('editItems') ?? false);
const cursor = ref(/** @type {string|null} */ (null));
const nodeQuery = useQuery({
  queryKey: computed(() => [...storageKeys.detail(publicId.value), cursor.value]),
  queryFn: () => getStorageNode(publicId.value, { cursor: cursor.value, limit: 25 }),
  enabled: computed(() => Boolean(session.summary)),
});
const fieldsQuery = useQuery({
  queryKey: schemaKeys.fieldsForScope('storage_node'),
  queryFn: () => listFieldDefinitions('storage_node', { includeArchived: false }),
  enabled: computed(() => Boolean(session.summary)),
});
const form = reactive({ title: '', nodeType: 'custom', code: '', visibility: 'authenticated' });
const attributes = reactive(/** @type {Record<string, unknown>} */ ({}));
const error = ref('');
const nodeTypes = computed(() =>
  ['site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom'].map((value) => ({
    value,
    label: t(`storage.types.${value}`),
  })),
);
const visibilities = computed(() =>
  ['public', 'authenticated', 'private', 'unlisted'].map((value) => ({
    value,
    label: t(`items.visibilities.${value}`),
  })),
);
const breadcrumbItems = computed(() =>
  (nodeQuery.data.value?.breadcrumb ?? []).map(
    (/** @type {{title:string, publicId:string}} */ entry) => ({
      label: entry.title,
      route: `/storage/${entry.publicId}`,
    }),
  ),
);
watch([nodeQuery.data, fieldsQuery.data], ([node, definitions]) => {
  if (!node) return;
  Object.assign(form, {
    title: node.title,
    nodeType: node.nodeType,
    code: node.code ?? '',
    visibility: node.visibility,
  });
  for (const definition of definitions ?? [])
    attributes[definition.key] = draftFromStored(definition, node.attributes?.[definition.key]);
});
const mutation = useMutation({
  mutationFn: () =>
    updateStorageNode(
      publicId.value,
      nodeQuery.data.value.version,
      {
        title: form.title.trim(),
        nodeType: form.nodeType,
        code: form.code.trim() || null,
        visibility: form.visibility,
        attributes: serializeAttributes(fieldsQuery.data.value ?? [], attributes),
      },
      session.summary?.csrfToken ?? '',
    ),
  onSuccess: async () => {
    error.value = '';
    await queryClient.invalidateQueries({ queryKey: storageKeys.all });
  },
  onError: (cause) => {
    error.value = t(problemMessageKey(cause));
  },
});
</script>

<template>
  <section class="storage-detail stack">
    <p v-if="nodeQuery.isLoading.value">{{ t('common.loading') }}</p>
    <p v-else-if="nodeQuery.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
    <template v-else-if="nodeQuery.data.value">
      <AppBreadcrumb :items="breadcrumbItems">
        <template #item="{ item }"
          ><RouterLink :to="item.route">{{ item.label }}</RouterLink></template
        >
      </AppBreadcrumb>
      <div class="page-heading">
        <div>
          <h1>{{ nodeQuery.data.value.title }}</h1>
          <p>{{ t(`storage.types.${nodeQuery.data.value.nodeType}`) }}</p>
        </div>
        <RouterLink v-if="canEdit" :to="`/storage?parent=${publicId}`">{{
          t('storage.addChild')
        }}</RouterLink>
      </div>

      <AppFormSection :title="t('storage.contents')">
        <ul class="storage-contents">
          <li
            v-for="entry in nodeQuery.data.value.contents.entries"
            :key="`${entry.kind}:${entry.publicId}`"
          >
            <RouterLink
              :to="
                entry.kind === 'node' ? `/storage/${entry.publicId}` : `/items/${entry.publicId}`
              "
            >
              {{ entry.title }} <small>{{ t(`storage.kinds.${entry.kind}`) }}</small>
            </RouterLink>
          </li>
          <li v-if="!nodeQuery.data.value.contents.entries.length">
            {{ t('storage.emptyContents') }}
          </li>
        </ul>
        <AppButton
          v-if="nodeQuery.data.value.contents.nextCursor"
          variant="secondary"
          @click="cursor = nodeQuery.data.value.contents.nextCursor"
          >{{ t('common.next') }}</AppButton
        >
      </AppFormSection>

      <form v-if="canEdit" @submit.prevent="mutation.mutate()">
        <AppFormSection :title="t('storage.edit')">
          <div class="storage-grid">
            <AppField input-id="node-title" :label="t('storage.title')"
              ><AppInput id="node-title" v-model="form.title"
            /></AppField>
            <AppField input-id="node-type" :label="t('storage.type')"
              ><AppSelect
                v-model="form.nodeType"
                input-id="node-type"
                :options="nodeTypes"
                option-label="label"
                option-value="value"
            /></AppField>
            <AppField input-id="node-code" :label="t('storage.code')"
              ><AppInput id="node-code" v-model="form.code"
            /></AppField>
            <AppField input-id="node-visibility" :label="t('items.visibility')"
              ><AppSelect
                v-model="form.visibility"
                input-id="node-visibility"
                :options="visibilities"
                option-label="label"
                option-value="value"
            /></AppField>
            <ItemAttributeField
              v-for="definition in fieldsQuery.data.value ?? []"
              :key="definition.id"
              v-model="attributes[definition.key]"
              :definition="definition"
            />
          </div>
          <p v-if="error" role="alert">{{ error }}</p>
          <AppButton type="submit" :loading="mutation.isPending.value">{{
            t('items.save')
          }}</AppButton>
        </AppFormSection>
      </form>
    </template>
  </section>
</template>

<style scoped>
.storage-contents {
  display: grid;
  gap: var(--ia-space-2);
  padding: 0;
  list-style: none;
}
.storage-contents a {
  display: flex;
  justify-content: space-between;
  min-height: var(--ia-control-min-height);
  padding: var(--ia-space-3);
  border-bottom: 1px solid var(--ia-color-border);
  color: inherit;
  text-decoration: none;
}
.storage-contents small {
  color: var(--ia-color-text-muted);
}
.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ia-space-4);
}
@media (max-width: 720px) {
  .storage-grid {
    grid-template-columns: 1fr;
  }
}
</style>
