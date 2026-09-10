<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import {
  AppButton,
  AppDataView,
  AppDialog,
  AppField,
  AppFormSection,
  AppInput,
  AppSelect,
} from '../shared/ui/index.js';
import {
  archiveDictionaryEntry,
  catalogKeys,
  createDictionaryEntry,
  listDictionary,
  updateDictionaryEntry,
} from '../features/catalog/api.js';
import DisplayTemplateEditor from '../features/catalog/DisplayTemplateEditor.vue';
import { useSessionContext } from '../shared/auth/session-context.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

const { t } = useI18n();
const route = useRoute();
const queryClient = useQueryClient();
const session = useSessionContext();
const isCategory = computed(() => route.path === '/admin/categories');
const kind = computed(() => (isCategory.value ? 'categories' : 'lifecycle-statuses'));
const queryKey = computed(() => (isCategory.value ? catalogKeys.categories : catalogKeys.statuses));
const title = computed(() =>
  t(isCategory.value ? 'routes.adminCategories' : 'routes.adminStatuses'),
);
const dialogVisible = ref(false);
const editingId = ref('');
const submitError = ref('');
const formErrors = reactive({ key: '', en: '', uk: '', displayOrder: '', colorToken: '' });
const formErrorKeys = /** @type {const} */ (['key', 'en', 'uk', 'displayOrder', 'colorToken']);
const form = reactive({
  key: '',
  en: '',
  uk: '',
  displayOrder: '0',
  parentId: '',
  displayTemplate: '',
  colorToken: 'status.info',
  version: 0,
});
const entries = useQuery({
  queryKey,
  queryFn: () => listDictionary(kind.value),
});
/** @typedef {{ id: string, key: string, labels: { en: string, uk?: string }, displayOrder: number, version: number, archivedAt: string|null, parentId?: string|null, displayTemplate?: string|null, colorToken?: string }} DictionaryEntry */
const dictionaryEntries = computed(
  () => /** @type {DictionaryEntry[]} */ (entries.data.value ?? []),
);
const parentOptions = computed(() => [
  { value: '', label: t('catalog.noParent') },
  ...dictionaryEntries.value
    .filter((entry) => !entry.archivedAt && entry.id !== editingId.value)
    .map((entry) => ({ value: entry.id, label: entry.labels.en })),
]);

function resetForm() {
  Object.assign(form, {
    key: '',
    en: '',
    uk: '',
    displayOrder: '0',
    parentId: '',
    displayTemplate: '',
    colorToken: 'status.info',
    version: 0,
  });
  formErrorKeys.forEach((key) => {
    formErrors[key] = '';
  });
  submitError.value = '';
}
function openCreate() {
  resetForm();
  editingId.value = '';
  dialogVisible.value = true;
}
/** @param {Record<string, any>} entry */
function openEdit(entry) {
  resetForm();
  editingId.value = entry.id;
  Object.assign(form, {
    key: entry.key,
    en: entry.labels.en,
    uk: entry.labels.uk ?? '',
    displayOrder: String(entry.displayOrder),
    parentId: entry.parentId ?? '',
    displayTemplate: entry.displayTemplate ?? '',
    colorToken: entry.colorToken ?? 'status.info',
    version: entry.version,
  });
  dialogVisible.value = true;
}
function validate() {
  formErrorKeys.forEach((key) => {
    formErrors[key] = '';
  });
  if (!editingId.value && !/^[a-z][a-z0-9_]{0,63}$/u.test(form.key))
    formErrors.key = t('catalog.validation.key');
  if (!form.en.trim()) formErrors.en = t('validation.required');
  if (form.uk && !form.uk.trim()) formErrors.uk = t('catalog.validation.ukrainian');
  const order = Number(form.displayOrder);
  if (!Number.isSafeInteger(order) || order < 0)
    formErrors.displayOrder = t('catalog.validation.order');
  if (!isCategory.value && !/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/u.test(form.colorToken))
    formErrors.colorToken = t('catalog.validation.color');
  return !Object.values(formErrors).some(Boolean);
}
function payload() {
  const common = {
    labels: { en: form.en.trim(), ...(form.uk.trim() ? { uk: form.uk.trim() } : {}) },
    displayOrder: Number(form.displayOrder),
  };
  return isCategory.value
    ? {
        ...common,
        parentId: form.parentId || null,
        displayTemplate: form.displayTemplate.trim() || null,
      }
    : { ...common, colorToken: form.colorToken };
}
/** @param {{ id: string, version: number }} entry */
function archiveOne(entry) {
  return archiveDictionaryEntry(
    kind.value,
    entry.id,
    entry.version,
    session.summary?.csrfToken ?? '',
  );
}
const save = useMutation({
  mutationFn: () =>
    editingId.value
      ? updateDictionaryEntry(
          kind.value,
          editingId.value,
          { expectedVersion: form.version, ...payload() },
          session.summary?.csrfToken ?? '',
        )
      : createDictionaryEntry(
          kind.value,
          { key: form.key, ...payload() },
          session.summary?.csrfToken ?? '',
        ),
  onSuccess: async () => {
    dialogVisible.value = false;
    await queryClient.invalidateQueries({ queryKey: queryKey.value });
  },
  onError: (error) => {
    submitError.value = t(problemMessageKey(error));
  },
});
const archive = useMutation({
  mutationFn: archiveOne,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey.value }),
});
function submit() {
  submitError.value = '';
  if (validate()) save.mutate();
}
watch(kind, () => {
  dialogVisible.value = false;
  resetForm();
});
</script>

<template>
  <section class="stack dictionary-page">
    <nav class="dictionary-tabs" :aria-label="t('nav.admin')">
      <RouterLink to="/admin/categories">{{ t('routes.adminCategories') }}</RouterLink>
      <RouterLink to="/admin/statuses">{{ t('routes.adminStatuses') }}</RouterLink>
    </nav>
    <div class="page-heading">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ t('catalog.description') }}</p>
      </div>
      <AppButton @click="openCreate">{{ t('catalog.create') }}</AppButton>
    </div>
    <AppFormSection :title="title">
      <AppDataView
        :items="entries.data.value ?? []"
        :loading="entries.isLoading.value"
        :error="entries.isError.value ? t('common.loadFailed') : ''"
      >
        <template #empty>{{ t('catalog.empty') }}</template>
        <template #list="{ items }">
          <ul class="record-list">
            <li v-for="entry in items" :key="entry.id" :class="{ archived: entry.archivedAt }">
              <div>
                <strong>{{ entry.labels.en }}</strong>
                <span v-if="entry.labels.uk"> / {{ entry.labels.uk }}</span>
                <small class="record-meta">
                  {{ entry.key }} · {{ t('catalog.orderValue', { order: entry.displayOrder }) }}
                  <span v-if="entry.archivedAt"> · {{ t('catalog.archived') }}</span>
                </small>
              </div>
              <div v-if="!entry.archivedAt" class="record-actions">
                <AppButton variant="secondary" @click="openEdit(entry)">{{
                  t('catalog.edit')
                }}</AppButton>
                <AppButton
                  variant="danger"
                  :loading="archive.isPending.value"
                  @click="archive.mutate(entry)"
                >
                  {{ t('catalog.archive') }}
                </AppButton>
              </div>
            </li>
          </ul>
        </template>
      </AppDataView>
    </AppFormSection>

    <AppDialog
      v-model:visible="dialogVisible"
      :title="editingId ? t('catalog.edit') : t('catalog.create')"
    >
      <form class="stack" @submit.prevent="submit">
        <AppField input-id="dictionary-key" :label="t('catalog.key')" :error="formErrors.key">
          <AppInput
            id="dictionary-key"
            v-model="form.key"
            :disabled="Boolean(editingId)"
            :invalid="Boolean(formErrors.key)"
            required
          />
        </AppField>
        <AppField
          input-id="dictionary-label-en"
          :label="t('catalog.labelEn')"
          :error="formErrors.en"
        >
          <AppInput
            id="dictionary-label-en"
            v-model="form.en"
            :invalid="Boolean(formErrors.en)"
            required
          />
        </AppField>
        <AppField
          input-id="dictionary-label-uk"
          :label="t('catalog.labelUk')"
          :error="formErrors.uk"
        >
          <AppInput id="dictionary-label-uk" v-model="form.uk" :invalid="Boolean(formErrors.uk)" />
        </AppField>
        <AppField
          input-id="dictionary-order"
          :label="t('catalog.displayOrder')"
          :error="formErrors.displayOrder"
        >
          <AppInput
            id="dictionary-order"
            v-model="form.displayOrder"
            type="number"
            min="0"
            :invalid="Boolean(formErrors.displayOrder)"
            required
          />
        </AppField>
        <template v-if="isCategory">
          <AppField input-id="dictionary-parent" :label="t('catalog.parent')">
            <AppSelect
              v-model="form.parentId"
              input-id="dictionary-parent"
              :options="parentOptions"
              option-label="label"
              option-value="value"
            />
          </AppField>
          <DisplayTemplateEditor
            v-model="form.displayTemplate"
            :category-id="editingId"
            :csrf-token="session.summary?.csrfToken ?? ''"
          />
        </template>
        <AppField
          v-else
          input-id="dictionary-color"
          :label="t('catalog.colorToken')"
          :error="formErrors.colorToken"
        >
          <AppInput
            id="dictionary-color"
            v-model="form.colorToken"
            :invalid="Boolean(formErrors.colorToken)"
            required
          />
        </AppField>
        <p v-if="submitError" role="alert">{{ submitError }}</p>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="dialogVisible = false">{{
          t('catalog.cancel')
        }}</AppButton>
        <AppButton :loading="save.isPending.value" @click="submit">{{
          t('catalog.save')
        }}</AppButton>
      </template>
    </AppDialog>
  </section>
</template>
