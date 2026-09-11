<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AppButton,
  AppField,
  AppFormSection,
  AppInput,
  AppSelect,
  AppTextarea,
} from '../shared/ui/index.js';
import { catalogKeys, listDictionary } from '../features/catalog/api.js';
import { listFieldDefinitions, schemaKeys } from '../features/schema/api.js';
import { getItem, itemKeys, updateItem } from '../features/items/api.js';
import {
  draftFromStored,
  formatTags,
  isEmptyValue,
  parseTags,
  serializeAttributes,
} from '../features/items/attribute-form.js';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import ItemMediaManager from '../features/media/ItemMediaManager.vue';
import { invalidateAfterMutation, routeConflict } from '../shared/api/mutations.js';
import { useSessionContext } from '../shared/auth/session-context.js';
import { fieldErrorsFromProblem } from '../shared/lib/form-errors.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

/** @typedef {{ id: string, labels: { en: string, uk?: string } }} DictionaryEntry */
/** @typedef {{ id: string, key: string, labels: { en: string, uk?: string }, dataType: string,
 * required: boolean, repeatable: boolean, visibility: string, defaultValue?: unknown,
 * options?: { id: string, labels: { en: string, uk?: string }, archivedAt?: string|null }[] }} FieldDefinition */

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const session = useSessionContext();

const publicId = computed(() => String(route.params.publicId ?? ''));
const canEdit = computed(() => session.summary?.permissions?.includes('editItems') ?? false);
const canViewPrivate = computed(
  () => session.summary?.permissions?.includes('viewPrivateFields') ?? false,
);

const form = reactive({
  categoryId: '',
  lifecycleStatusId: '',
  displayName: '',
  description: '',
  visibility: 'authenticated',
  tags: '',
});
const attributes = reactive(/** @type {Record<string, unknown>} */ ({}));
const errors = reactive(/** @type {Record<string, string>} */ ({}));
const submitError = ref('');
const saved = ref(false);
const comparing = ref(false);
/**
 * Page-local conflict state. `routeConflict` fills it from the rejected response; the page never
 * merges a value on its own.
 * @type {import('vue').Ref<{ currentVersion: unknown, safeDiff: unknown, actions: string[] }|null>}
 */
const conflictModel = ref(null);
const conflict = {
  /** @param {{ currentVersion: unknown, safeDiff: unknown, actions: string[] }} model */
  open: (model) => {
    conflictModel.value = model;
  },
  close: () => {
    conflictModel.value = null;
  },
};

const itemQuery = useQuery({
  queryKey: computed(() => itemKeys.detail(publicId.value)),
  queryFn: () => getItem(publicId.value),
  enabled: computed(() => canEdit.value && Boolean(publicId.value)),
});
const item = computed(
  () => /** @type {Record<string, unknown>|null} */ (itemQuery.data.value ?? null),
);
const loadedVersion = computed(() =>
  typeof item.value?.version === 'number' ? item.value.version : undefined,
);

const categories = useQuery({
  queryKey: [...catalogKeys.categories, 'active'],
  queryFn: () => listDictionary('categories', false),
  enabled: canEdit,
});
const statuses = useQuery({
  queryKey: [...catalogKeys.statuses, 'active'],
  queryFn: () => listDictionary('lifecycle-statuses', false),
  enabled: canEdit,
});
const definitionsQuery = useQuery({
  queryKey: computed(() => schemaKeys.fieldsForCategory(form.categoryId)),
  queryFn: () =>
    listFieldDefinitions('item', { categoryId: form.categoryId, includeArchived: false }),
  enabled: computed(() => canEdit.value && Boolean(form.categoryId)),
});

const definitions = computed(() => definitionsQuery.data.value ?? []);
const visibleDefinitions = computed(() =>
  /** @type {FieldDefinition[]} */ (definitions.value).filter(
    (/** @type {FieldDefinition} */ definition) =>
      definition.visibility !== 'private' || canViewPrivate.value,
  ),
);
const categoryOptions = computed(() => dictionaryOptions(categories.data.value));
const statusOptions = computed(() => dictionaryOptions(statuses.data.value));
const visibilityOptions = computed(() =>
  ['public', 'authenticated', 'private', 'unlisted']
    .filter((value) => value !== 'private' || canViewPrivate.value)
    .map((value) => ({ value, label: t(`items.visibilities.${value}`) })),
);

/** Conflict rows are rendered from the safe diff the server sent; nothing is merged silently. */
const conflictRows = computed(() => {
  const safeDiff = /** @type {Record<string, unknown>} */ (conflictModel.value?.safeDiff ?? {});
  return Object.entries(safeDiff).map(([field, entry]) => {
    const values = /** @type {{ current?: unknown, submitted?: unknown }} */ (entry ?? {});
    return {
      field,
      label: fieldLabel(field),
      current: displayValue(values.current),
      submitted: displayValue(values.submitted),
    };
  });
});
const conflictVersion = computed(() => conflictModel.value?.currentVersion ?? null);

watch(item, (loaded) => {
  if (loaded) resetFormFrom(loaded);
});
watch(definitions, () => {
  if (item.value) applyStoredAttributes(item.value);
});

const mutation = useMutation({
  mutationFn: () =>
    updateItem(
      publicId.value,
      Number(loadedVersion.value),
      payload(),
      session.summary?.csrfToken ?? '',
    ),
  onSuccess: async (updated) => {
    conflict.close();
    comparing.value = false;
    submitError.value = '';
    saved.value = true;
    queryClient.setQueryData(itemKeys.detail(publicId.value), {
      ...item.value,
      .../** @type {Record<string, unknown>} */ (updated),
    });
    await invalidateAfterMutation(queryClient, itemKeys.detail(publicId.value));
  },
  onError: (error) => {
    saved.value = false;
    if (routeConflict(error, conflict)) {
      comparing.value = false;
      submitError.value = t('items.conflictDetected');
      return;
    }
    const mapped = fieldErrorsFromProblem(
      error && typeof error === 'object' && 'detail' in error ? error.detail : null,
    );
    Object.assign(
      errors,
      Object.fromEntries(
        Object.keys(mapped).map((fieldKey) => [fieldKey, t('validation.invalid')]),
      ),
    );
    submitError.value = t(problemMessageKey(error));
  },
});

/** @param {unknown} entries */
function dictionaryOptions(entries) {
  return /** @type {DictionaryEntry[]} */ (entries ?? []).map((entry) => ({
    value: entry.id,
    label: localized(entry.labels),
  }));
}

/** @param {{ en?: string, uk?: string }|null|undefined} value */
function localized(value) {
  const key = /** @type {'en'|'uk'} */ (locale.value);
  return value?.[key] || value?.en || '';
}

/** Core diff keys are aggregate field names; the UI owns their localized labels. */
const coreFieldLabels = {
  categoryId: 'items.category',
  lifecycleStatusId: 'items.lifecycleStatus',
  displayName: 'items.displayName',
  description: 'items.description',
  visibility: 'items.visibility',
  storageNodeId: 'items.location',
};

/** @param {string} field */
function fieldLabel(field) {
  if (!field.startsWith('attributes.'))
    return field in coreFieldLabels
      ? t(coreFieldLabels[/** @type {keyof typeof coreFieldLabels} */ (field)])
      : field;
  const key = field.slice('attributes.'.length);
  const definition = /** @type {FieldDefinition[]} */ (definitions.value).find(
    (entry) => entry.key === key,
  );
  return definition ? localized(definition.labels) : key;
}

/** @param {unknown} value @returns {string} */
function displayValue(value) {
  if (value === null || value === undefined || value === '') return t('items.emptyValue');
  if (Array.isArray(value))
    return value.map((/** @type {unknown} */ entry) => displayValue(entry)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** @param {Record<string, unknown>} loaded */
function resetFormFrom(loaded) {
  Object.assign(form, {
    categoryId: String(loaded.categoryId ?? ''),
    lifecycleStatusId: String(loaded.lifecycleStatusId ?? ''),
    displayName: String(loaded.displayName ?? ''),
    description: loaded.description == null ? '' : String(loaded.description),
    visibility: String(loaded.visibility ?? 'authenticated'),
    tags: formatTags(/** @type {string[]} */ (loaded.tags)),
  });
  applyStoredAttributes(loaded);
  clearErrors();
}

/** @param {Record<string, unknown>} loaded */
function applyStoredAttributes(loaded) {
  const stored = /** @type {Record<string, unknown>} */ (loaded.attributes ?? {});
  for (const key of Object.keys(attributes)) delete attributes[key];
  for (const definition of /** @type {FieldDefinition[]} */ (definitions.value)) {
    if (stored[definition.key] === undefined) continue;
    attributes[definition.key] = draftFromStored(definition, stored[definition.key]);
  }
}

function clearErrors() {
  for (const key of Object.keys(errors)) delete errors[key];
  submitError.value = '';
}

function validate() {
  clearErrors();
  if (!form.categoryId) errors.categoryId = t('validation.required');
  if (!form.lifecycleStatusId) errors.lifecycleStatusId = t('validation.required');
  if (!form.displayName.trim()) errors.displayName = t('validation.required');
  for (const definition of visibleDefinitions.value) {
    if (definition.required && isEmptyValue(attributes[definition.key]))
      errors[`attributes.${definition.key}`] = t('validation.required');
  }
  return !Object.keys(errors).length;
}

function payload() {
  return {
    categoryId: form.categoryId,
    lifecycleStatusId: form.lifecycleStatusId,
    displayName: form.displayName.trim(),
    description: form.description.trim() || null,
    visibility: form.visibility,
    tags: parseTags(form.tags),
    attributes: serializeAttributes(visibleDefinitions.value, attributes),
  };
}

function submit() {
  saved.value = false;
  if (loadedVersion.value === undefined || !validate()) return;
  mutation.mutate();
}

function compareConflict() {
  comparing.value = true;
}

/** Discards the rejected draft and re-reads the winning version; no value is merged silently. */
async function reloadConflict() {
  conflict.close();
  comparing.value = false;
  const { data } = await itemQuery.refetch();
  if (data) resetFormFrom(/** @type {Record<string, unknown>} */ (data));
}

function abandonConflict() {
  conflict.close();
  comparing.value = false;
  void router.push(`/items/${publicId.value}`);
}
</script>

<template>
  <section class="item-edit-page">
    <template v-if="canEdit">
      <div class="page-heading">
        <div>
          <h1>{{ t('routes.itemEdit') }}</h1>
          <p v-if="loadedVersion !== undefined">
            {{ t('items.currentVersion', { version: loadedVersion }) }}
          </p>
        </div>
      </div>

      <p v-if="itemQuery.isLoading.value">{{ t('common.loading') }}</p>
      <p v-else-if="itemQuery.isError.value" role="alert">{{ t('common.loadFailed') }}</p>

      <section
        v-else-if="conflictModel"
        class="item-conflict"
        role="alert"
        :aria-label="t('items.conflictTitle')"
      >
        <h2>{{ t('items.conflictTitle') }}</h2>
        <p>{{ t('items.conflictExplanation', { version: conflictVersion }) }}</p>
        <table v-if="comparing && conflictRows.length" class="item-conflict__table">
          <thead>
            <tr>
              <th scope="col">{{ t('items.conflictField') }}</th>
              <th scope="col">{{ t('items.conflictCurrent') }}</th>
              <th scope="col">{{ t('items.conflictSubmitted') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in conflictRows" :key="row.field">
              <th scope="row">{{ row.label }}</th>
              <td>{{ row.current }}</td>
              <td>{{ row.submitted }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="comparing">{{ t('items.conflictNoVisibleFields') }}</p>
        <div class="item-conflict__actions">
          <AppButton v-if="!comparing" type="button" variant="secondary" @click="compareConflict">
            {{ t('items.conflictCompare') }}
          </AppButton>
          <AppButton type="button" @click="reloadConflict">
            {{ t('items.conflictReload') }}
          </AppButton>
          <AppButton type="button" variant="secondary" @click="abandonConflict">
            {{ t('items.conflictAbandon') }}
          </AppButton>
        </div>
      </section>

      <form v-else-if="item" class="item-form" novalidate @submit.prevent="submit">
        <p v-if="saved" role="status">{{ t('items.updated') }}</p>
        <AppFormSection :title="t('items.coreFields')">
          <div class="item-form__grid">
            <AppField
              input-id="item-category"
              :label="t('items.category')"
              :error="errors.categoryId"
            >
              <AppSelect
                v-model="form.categoryId"
                input-id="item-category"
                :options="categoryOptions"
                option-label="label"
                option-value="value"
                :invalid="Boolean(errors.categoryId)"
                :aria-label="t('items.category')"
              />
            </AppField>
            <AppField
              input-id="item-status"
              :label="t('items.lifecycleStatus')"
              :error="errors.lifecycleStatusId"
            >
              <AppSelect
                v-model="form.lifecycleStatusId"
                input-id="item-status"
                :options="statusOptions"
                option-label="label"
                option-value="value"
                :invalid="Boolean(errors.lifecycleStatusId)"
                :aria-label="t('items.lifecycleStatus')"
              />
            </AppField>
            <AppField
              input-id="item-name"
              :label="t('items.displayName')"
              :error="errors.displayName"
            >
              <AppInput
                id="item-name"
                v-model="form.displayName"
                maxlength="200"
                :invalid="Boolean(errors.displayName)"
              />
            </AppField>
            <AppField
              input-id="item-visibility"
              :label="t('items.visibility')"
              :error="errors.visibility"
            >
              <AppSelect
                v-model="form.visibility"
                input-id="item-visibility"
                :options="visibilityOptions"
                option-label="label"
                option-value="value"
                :aria-label="t('items.visibility')"
              />
            </AppField>
            <AppField
              class="item-form__wide"
              input-id="item-description"
              :label="t('items.description')"
              :error="errors.description"
            >
              <AppTextarea
                id="item-description"
                v-model="form.description"
                rows="4"
                maxlength="10000"
              />
            </AppField>
            <AppField
              class="item-form__wide"
              input-id="item-tags"
              :label="t('items.tags')"
              :error="errors.tags"
            >
              <AppInput id="item-tags" v-model="form.tags" :placeholder="t('items.tagsHint')" />
            </AppField>
          </div>
        </AppFormSection>

        <AppFormSection v-if="form.categoryId" :title="t('items.attributes')">
          <p v-if="definitionsQuery.isLoading.value">{{ t('common.loading') }}</p>
          <p v-else-if="definitionsQuery.isError.value" role="alert">
            {{ t('common.loadFailed') }}
          </p>
          <p v-else-if="!visibleDefinitions.length" class="item-card__muted">
            {{ t('items.noAttributes') }}
          </p>
          <div v-else class="item-form__attributes">
            <ItemAttributeField
              v-for="definition in visibleDefinitions"
              :key="definition.id"
              v-model="attributes[definition.key]"
              :definition="definition"
              :error="errors[`attributes.${definition.key}`]"
            />
          </div>
        </AppFormSection>

        <AppFormSection :title="t('media.section')">
          <ItemMediaManager
            :item-public-id="publicId"
            :expected-version="loadedVersion ?? 0"
            :csrf-token="session.summary?.csrfToken ?? ''"
            :can-edit="canEdit"
          />
        </AppFormSection>

        <p v-if="submitError" role="alert">{{ submitError }}</p>
        <div class="item-form__actions">
          <AppButton type="submit" :loading="mutation.isPending.value">{{
            t('items.save')
          }}</AppButton>
        </div>
      </form>
    </template>

    <div v-else class="auth-panel">
      <h1>{{ t('routes.itemEdit') }}</h1>
      <p role="alert">
        {{ session.summary ? t('problems.forbidden') : t('problems.unauthorized') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.item-edit-page,
.item-form {
  display: grid;
  gap: var(--ia-space-6);
}
.item-form__grid,
.item-form__attributes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ia-space-4);
}
.item-form__wide {
  grid-column: 1 / -1;
}
.item-form__actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  padding: var(--ia-space-3);
  border-top: 1px solid var(--ia-color-border);
  background: color-mix(in srgb, var(--ia-color-surface-50) 92%, transparent);
}
.item-conflict {
  display: grid;
  gap: var(--ia-space-4);
  padding: var(--ia-space-4);
  border: 1px solid var(--ia-color-border);
  border-radius: var(--ia-radius-lg);
  background: var(--ia-color-surface-0);
}
.item-conflict h2,
.item-conflict p {
  margin: 0;
}
.item-conflict__table {
  width: 100%;
  border-collapse: collapse;
  text-align: start;
}
.item-conflict__table th,
.item-conflict__table td {
  padding: var(--ia-space-2);
  border-bottom: 1px solid var(--ia-color-border);
  text-align: start;
  overflow-wrap: anywhere;
}
.item-conflict__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ia-space-2);
}
@media (max-width: 720px) {
  .item-form__grid,
  .item-form__attributes {
    grid-template-columns: 1fr;
  }
  .item-form__actions :deep(button),
  .item-conflict__actions :deep(button) {
    width: 100%;
  }
}
</style>
