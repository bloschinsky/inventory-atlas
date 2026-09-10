<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery } from '@tanstack/vue-query';
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
import { createItem } from '../features/items/api.js';
import ItemAttributeField from '../features/items/ItemAttributeField.vue';
import ItemCard from '../features/items/ItemCard.vue';
import { useSessionContext } from '../shared/auth/session-context.js';
import { fieldErrorsFromProblem } from '../shared/lib/form-errors.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

/** @typedef {{ id: string, labels: { en: string, uk?: string }, archivedAt?: string|null }} DictionaryEntry */
/** @typedef {{ id: string, key: string, labels: { en: string, uk?: string }, dataType: string,
 * required: boolean, repeatable: boolean, visibility: string, defaultValue?: unknown,
 * options?: { id: string, labels: { en: string, uk?: string }, archivedAt?: string|null }[] }} FieldDefinition */

const { t, locale } = useI18n();
const session = useSessionContext();
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
const createdCard = ref(/** @type {Record<string, unknown>|null} */ (null));
const requestKey = ref(crypto.randomUUID());

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

const activeCategories = computed(() => categories.data.value ?? []);
const activeStatuses = computed(() => statuses.data.value ?? []);
const definitions = computed(() => definitionsQuery.data.value ?? []);
const visibleDefinitions = computed(() =>
  /** @type {FieldDefinition[]} */ (definitions.value).filter(
    (/** @type {FieldDefinition} */ definition) =>
      definition.visibility !== 'private' || canViewPrivate.value,
  ),
);
const categoryOptions = computed(() =>
  /** @type {DictionaryEntry[]} */ (activeCategories.value).map(
    (/** @type {DictionaryEntry} */ entry) => ({
      value: entry.id,
      label: localized(entry.labels),
    }),
  ),
);
const statusOptions = computed(() =>
  /** @type {DictionaryEntry[]} */ (activeStatuses.value).map(
    (/** @type {DictionaryEntry} */ entry) => ({
      value: entry.id,
      label: localized(entry.labels),
    }),
  ),
);
const visibilityOptions = computed(() =>
  ['public', 'authenticated', 'private', 'unlisted']
    .filter((value) => value !== 'private' || canViewPrivate.value)
    .map((value) => ({ value, label: t(`items.visibilities.${value}`) })),
);
const selectedCategory = computed(() =>
  /** @type {DictionaryEntry[]} */ (activeCategories.value).find(
    (/** @type {DictionaryEntry} */ entry) => entry.id === form.categoryId,
  ),
);
const selectedStatus = computed(() =>
  /** @type {DictionaryEntry[]} */ (activeStatuses.value).find(
    (/** @type {DictionaryEntry} */ entry) => entry.id === form.lifecycleStatusId,
  ),
);

watch(
  () => form.categoryId,
  () => {
    for (const key of Object.keys(attributes)) delete attributes[key];
    clearAttributeErrors();
  },
);
watch(definitions, (next) => {
  for (const definition of next) {
    if (attributes[definition.key] !== undefined || definition.defaultValue == null) continue;
    attributes[definition.key] = draftDefault(definition);
  }
});

const mutation = useMutation({
  mutationFn: () => createItem(payload(), session.summary?.csrfToken ?? '', requestKey.value),
  onSuccess: (created) => {
    const preparedAttributes = serializedAttributes();
    createdCard.value = {
      ...created,
      categoryId: form.categoryId,
      lifecycleStatusId: form.lifecycleStatusId,
      description: form.description.trim() || null,
      visibility: form.visibility,
      tags: parsedTags(),
      attributes: preparedAttributes,
    };
    submitError.value = '';
  },
  onError: (error) => {
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

/** @param {{ en?: string, uk?: string }|null|undefined} value */
function localized(value) {
  const key = /** @type {'en'|'uk'} */ (locale.value);
  return value?.[key] || value?.en || '';
}

/** @param {Record<string, unknown>} definition */
function draftDefault(definition) {
  const stored = Array.isArray(definition.defaultValue)
    ? definition.defaultValue
    : [definition.defaultValue];
  const values = stored.map((value) => {
    if ((definition.dataType === 'date' || definition.dataType === 'datetime') && value)
      return new Date(String(value));
    return value;
  });
  return definition.repeatable || definition.dataType === 'multiselect' ? values : values[0];
}

function clearErrors() {
  for (const key of Object.keys(errors)) delete errors[key];
  submitError.value = '';
}

function clearAttributeErrors() {
  for (const key of Object.keys(errors)) if (key.startsWith('attributes.')) delete errors[key];
}

function validate() {
  clearErrors();
  if (!form.categoryId) errors.categoryId = t('validation.required');
  if (!form.lifecycleStatusId) errors.lifecycleStatusId = t('validation.required');
  if (!form.displayName.trim()) errors.displayName = t('validation.required');
  for (const definition of visibleDefinitions.value) {
    if (definition.required && isEmpty(attributes[definition.key]))
      errors[`attributes.${definition.key}`] = t('validation.required');
  }
  return !Object.keys(errors).length;
}

/** @param {unknown} value */
function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  if (typeof value === 'object' && 'amount' in value)
    return value.amount === null || value.amount === '';
  if (typeof value === 'object' && 'id' in value) return !value.id;
  return false;
}

/** @param {Record<string, unknown>} definition @param {unknown} value */
function serializeValue(definition, value) {
  if (value instanceof Date) {
    if (definition.dataType === 'date')
      return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
    return value.toISOString();
  }
  if (definition.dataType === 'money' && value && typeof value === 'object') {
    const money = /** @type {{ amount: unknown, currency: unknown }} */ (value);
    return {
      ...money,
      amount: String(money.amount),
      currency: String(money.currency).toUpperCase(),
    };
  }
  return typeof value === 'string' ? value.trim() : value;
}

function serializedAttributes() {
  return Object.fromEntries(
    visibleDefinitions.value.flatMap((/** @type {FieldDefinition} */ definition) => {
      const raw = attributes[definition.key];
      if (isEmpty(raw)) return [];
      const value = Array.isArray(raw)
        ? raw.filter((entry) => !isEmpty(entry)).map((entry) => serializeValue(definition, entry))
        : serializeValue(definition, raw);
      return [[definition.key, value]];
    }),
  );
}

function parsedTags() {
  return [
    ...new Set(
      form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function payload() {
  return {
    categoryId: form.categoryId,
    lifecycleStatusId: form.lifecycleStatusId,
    displayName: form.displayName.trim(),
    description: form.description.trim() || null,
    visibility: form.visibility,
    tags: parsedTags(),
    attributes: serializedAttributes(),
  };
}

function submit() {
  if (validate()) mutation.mutate();
}

function createAnother() {
  Object.assign(form, {
    categoryId: '',
    lifecycleStatusId: '',
    displayName: '',
    description: '',
    visibility: 'authenticated',
    tags: '',
  });
  for (const key of Object.keys(attributes)) delete attributes[key];
  createdCard.value = null;
  requestKey.value = crypto.randomUUID();
  clearErrors();
}
</script>

<template>
  <section class="item-create-page">
    <template v-if="createdCard">
      <div class="page-heading">
        <div>
          <p>{{ t('items.created') }}</p>
          <h2>{{ t('items.card') }}</h2>
        </div>
        <AppButton @click="createAnother">{{ t('items.createAnother') }}</AppButton>
      </div>
      <ItemCard
        :item="createdCard"
        :definitions="visibleDefinitions"
        :category="selectedCategory"
        :lifecycle-status="selectedStatus"
        :can-view-private-path="canViewPrivate"
      />
    </template>

    <template v-else-if="canEdit">
      <div class="page-heading">
        <div>
          <h1>{{ t('routes.itemNew') }}</h1>
          <p>{{ t('items.createDescription') }}</p>
        </div>
      </div>
      <form class="item-form" novalidate @submit.prevent="submit">
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

        <p v-if="submitError" role="alert">{{ submitError }}</p>
        <div class="item-form__actions">
          <AppButton type="submit" :loading="mutation.isPending.value">{{
            t('items.create')
          }}</AppButton>
        </div>
      </form>
    </template>

    <div v-else class="auth-panel">
      <h1>{{ t('routes.itemNew') }}</h1>
      <p role="alert">
        {{ session.summary ? t('problems.forbidden') : t('problems.unauthorized') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.item-create-page,
.item-form {
  display: grid;
  gap: var(--ia-space-6);
}
.item-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ia-space-4);
}
.item-form__wide {
  grid-column: 1 / -1;
}
.item-form__attributes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ia-space-4);
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
@media (max-width: 720px) {
  .item-form__grid,
  .item-form__attributes {
    grid-template-columns: 1fr;
  }
  .item-form__actions :deep(button) {
    width: 100%;
  }
}
</style>
