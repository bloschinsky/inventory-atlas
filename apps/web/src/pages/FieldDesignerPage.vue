<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import {
  AppButton,
  AppDataView,
  AppDateField,
  AppDialog,
  AppField,
  AppFormSection,
  AppInput,
  AppMoneyField,
  AppMultiSelect,
  AppSelect,
  AppTextarea,
} from '../shared/ui/index.js';
import {
  archiveFieldDefinition,
  archiveFieldOption,
  createFieldDefinition,
  createFieldOption,
  listFieldDefinitions,
  previewFieldConversion,
  schemaKeys,
  updateFieldDefinition,
} from '../features/schema/api.js';
import { catalogKeys, listDictionary } from '../features/catalog/api.js';
import { useSessionContext } from '../shared/auth/session-context.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

/**
 * @typedef {{ id: string, key: string, labels: { en: string, uk?: string }, displayOrder: number,
 *   archivedAt: string|null }} FieldOption
 * @typedef {{ id: string, key: string, scope: string, categoryId: string|null,
 *   labels: { en: string, uk?: string }, help: { en: string, uk?: string }|null, dataType: string,
 *   required: boolean, repeatable: boolean, searchable: boolean, filterable: boolean,
 *   sortable: boolean, visibility: string, unit: string|null, defaultValue: unknown[]|null,
 *   validation: Record<string, unknown>, displayOrder: number, version: number,
 *   archivedAt: string|null, options: FieldOption[] }} FieldDefinition
 */

const dataTypes = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'url',
  'email',
  'money',
  'reference',
];
const visibilities = ['public', 'authenticated', 'private'];
const optionTypes = ['select', 'multiselect'];
const flagNames = /** @type {const} */ ([
  'required',
  'repeatable',
  'searchable',
  'filterable',
  'sortable',
]);
const ruleNames = {
  text: ['minLength', 'maxLength', 'pattern'],
  long_text: ['minLength', 'maxLength', 'pattern'],
  url: ['minLength', 'maxLength', 'pattern'],
  email: ['minLength', 'maxLength', 'pattern'],
  number: ['min', 'max', 'integer'],
  date: ['min', 'max'],
  datetime: ['min', 'max'],
  money: ['min', 'max', 'currencies'],
  multiselect: ['minSelected', 'maxSelected'],
  reference: ['referenceScope'],
  boolean: [],
  select: [],
};
const integerRules = ['minLength', 'maxLength', 'minSelected', 'maxSelected'];

/**
 * Locale keys are stable camelCase identifiers, so snake_case enum values are mapped.
 * @param {string} value
 */
function messageKey(value) {
  return value.replace(/_(.)/gu, (/** @type {string} */ _match, /** @type {string} */ letter) =>
    letter.toUpperCase(),
  );
}

const { t } = useI18n();
const queryClient = useQueryClient();
const session = useSessionContext();
const csrfToken = computed(() => session.summary?.csrfToken ?? '');
const scope = ref('item');
const dialogVisible = ref(false);
const editing = ref(/** @type {FieldDefinition|null} */ (null));
const submitError = ref('');
const reindexNotice = ref(/** @type {string[]} */ ([]));
const conversion = ref(/** @type {Record<string, unknown>|null} */ (null));
/** The data type the loaded rules belong to, so loading a field never clears its own rules. */
const rulesFor = ref('text');
const optionDraft = reactive({ key: '', en: '', uk: '' });
const formErrors = reactive({ key: '', en: '', uk: '', displayOrder: '', unit: '', option: '' });
const form = reactive({
  key: '',
  en: '',
  uk: '',
  helpEn: '',
  helpUk: '',
  dataType: 'text',
  categoryId: '',
  visibility: 'authenticated',
  unit: '',
  displayOrder: '0',
  required: false,
  repeatable: false,
  searchable: false,
  filterable: false,
  sortable: false,
  rules: /** @type {Record<string, string>} */ ({}),
});
/** One typed model per preview control, so each facade component keeps its own value type. */
const defaultDraft = reactive({
  text: '',
  boolean: /** @type {boolean|null} */ (null),
  date: /** @type {Date|null} */ (null),
  money: /** @type {number|null} */ (null),
  currency: 'UAH',
  option: /** @type {string|null} */ (null),
  options: /** @type {string[]} */ ([]),
});

const definitions = useQuery({
  queryKey: computed(() => schemaKeys.fieldsForScope(scope.value)),
  queryFn: () => listFieldDefinitions(/** @type {'item'|'storage_node'} */ (scope.value)),
});
const categories = useQuery({
  queryKey: catalogKeys.categories,
  queryFn: () => listDictionary('categories'),
});

const fields = computed(() => /** @type {FieldDefinition[]} */ (definitions.data.value ?? []));
const categoryOptions = computed(() => [
  { value: '', label: t('schema.wholeScope') },
  .../** @type {{ id: string, labels: { en: string }, archivedAt: string|null }[]} */ (
    categories.data.value ?? []
  )
    .filter((category) => !category.archivedAt)
    .map((category) => ({ value: category.id, label: category.labels.en })),
]);
const dataTypeOptions = computed(() =>
  dataTypes.map((value) => ({ value, label: t(`schema.dataTypes.${messageKey(value)}`) })),
);
const visibilityOptions = computed(() =>
  visibilities.map((value) => ({ value, label: t(`schema.visibilities.${value}`) })),
);
const booleanOptions = computed(() => [
  { value: false, label: t('common.no') },
  { value: true, label: t('common.yes') },
]);
const activeOptions = computed(
  () => editing.value?.options.filter((entry) => !entry.archivedAt) ?? [],
);
const previewOptions = computed(() =>
  activeOptions.value.map((entry) => ({ value: entry.id, label: entry.labels.en })),
);
const usesOptions = computed(() => optionTypes.includes(form.dataType));
const applicableRules = computed(
  () => ruleNames[/** @type {keyof typeof ruleNames} */ (form.dataType)] ?? [],
);
const conversionRequired = computed(
  () => Boolean(editing.value) && editing.value?.dataType !== form.dataType,
);
const repeatableLocked = computed(() => usesOptions.value);

function resetForm() {
  Object.assign(form, {
    key: '',
    en: '',
    uk: '',
    helpEn: '',
    helpUk: '',
    dataType: 'text',
    categoryId: '',
    visibility: 'authenticated',
    unit: '',
    displayOrder: '0',
    required: false,
    repeatable: false,
    searchable: false,
    filterable: false,
    sortable: false,
    rules: {},
  });
  resetPreview();
  rulesFor.value = 'text';
  Object.assign(optionDraft, { key: '', en: '', uk: '' });
  Object.keys(formErrors).forEach((key) => {
    formErrors[/** @type {keyof typeof formErrors} */ (key)] = '';
  });
  submitError.value = '';
  conversion.value = null;
}

function resetPreview() {
  Object.assign(defaultDraft, {
    text: '',
    boolean: null,
    date: null,
    money: null,
    currency: 'UAH',
    option: null,
    options: [],
  });
}

/**
 * Loads the stored default into the control that renders the field's data type.
 * @param {FieldDefinition} definition
 */
function loadPreview(definition) {
  const stored = definition.defaultValue ?? [];
  if (!stored.length) return;
  const [first] = stored;
  if (definition.dataType === 'boolean') defaultDraft.boolean = Boolean(first);
  else if (definition.dataType === 'date' || definition.dataType === 'datetime')
    defaultDraft.date = new Date(String(first));
  else if (definition.dataType === 'money') {
    const money = /** @type {{ amount?: string, currency?: string }} */ (first ?? {});
    defaultDraft.money = money.amount === undefined ? null : Number(money.amount);
    defaultDraft.currency = money.currency ?? 'UAH';
  } else defaultDraft.text = String(first);
}

/** Projects the preview control back into the API shape the field accepts as a default. */
function defaultValuePayload() {
  if (usesOptions.value || form.dataType === 'reference') return null;
  if (form.dataType === 'boolean') return defaultDraft.boolean;
  if (form.dataType === 'date') return defaultDraft.date ? isoDate(defaultDraft.date) : null;
  if (form.dataType === 'datetime')
    return defaultDraft.date ? defaultDraft.date.toISOString() : null;
  if (form.dataType === 'money')
    return defaultDraft.money === null
      ? null
      : {
          amount: String(defaultDraft.money),
          currency: defaultDraft.currency.trim().toUpperCase(),
        };
  return defaultDraft.text.trim() || null;
}

/** @param {Date} value */
function isoDate(value) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function openCreate() {
  resetForm();
  editing.value = null;
  reindexNotice.value = [];
  dialogVisible.value = true;
}

/** @param {FieldDefinition} definition */
function openEdit(definition) {
  resetForm();
  editing.value = definition;
  rulesFor.value = definition.dataType;
  reindexNotice.value = [];
  Object.assign(form, {
    key: definition.key,
    en: definition.labels.en,
    uk: definition.labels.uk ?? '',
    helpEn: definition.help?.en ?? '',
    helpUk: definition.help?.uk ?? '',
    dataType: definition.dataType,
    categoryId: definition.categoryId ?? '',
    visibility: definition.visibility,
    unit: definition.unit ?? '',
    displayOrder: String(definition.displayOrder),
    required: definition.required,
    repeatable: definition.repeatable,
    searchable: definition.searchable,
    filterable: definition.filterable,
    sortable: definition.sortable,
    rules: Object.fromEntries(
      Object.entries(definition.validation).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : String(value),
      ]),
    ),
  });
  loadPreview(definition);
  dialogVisible.value = true;
}

function validate() {
  Object.keys(formErrors).forEach((key) => {
    formErrors[/** @type {keyof typeof formErrors} */ (key)] = '';
  });
  if (!editing.value && !/^[a-z][a-z0-9_]{0,63}$/u.test(form.key))
    formErrors.key = t('schema.validation.key');
  if (!form.en.trim()) formErrors.en = t('validation.required');
  const order = Number(form.displayOrder);
  if (!Number.isSafeInteger(order) || order < 0)
    formErrors.displayOrder = t('schema.validation.order');
  if (form.unit.trim().length > 32) formErrors.unit = t('schema.validation.unit');
  return !Object.values(formErrors).some(Boolean);
}

function rulePayload() {
  /** @type {Record<string, unknown>} */
  const rules = {};
  for (const name of applicableRules.value) {
    const raw = (form.rules[name] ?? '').trim();
    if (!raw) continue;
    if (name === 'integer') rules[name] = raw === 'true';
    else if (name === 'currencies')
      rules[name] = raw
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);
    else if (integerRules.includes(name)) rules[name] = Number(raw);
    else rules[name] = raw;
  }
  return rules;
}

function payload() {
  const labels = { en: form.en.trim(), ...(form.uk.trim() ? { uk: form.uk.trim() } : {}) };
  const help = form.helpEn.trim()
    ? { en: form.helpEn.trim(), ...(form.helpUk.trim() ? { uk: form.helpUk.trim() } : {}) }
    : null;
  return {
    labels,
    help,
    dataType: form.dataType,
    categoryId: form.categoryId || null,
    visibility: form.visibility,
    unit: form.unit.trim() || null,
    displayOrder: Number(form.displayOrder),
    required: form.required,
    repeatable: repeatableLocked.value ? false : form.repeatable,
    searchable: form.searchable,
    filterable: form.filterable,
    sortable: form.sortable,
    defaultValue: defaultValuePayload(),
    validation: rulePayload(),
  };
}

async function invalidate() {
  await queryClient.invalidateQueries({ queryKey: schemaKeys.fieldsForScope(scope.value) });
}

const save = useMutation({
  mutationFn: () =>
    editing.value
      ? updateFieldDefinition(
          editing.value.id,
          { expectedVersion: editing.value.version, ...payload() },
          csrfToken.value,
        )
      : createFieldDefinition({ key: form.key, scope: scope.value, ...payload() }, csrfToken.value),
  onSuccess: async (result) => {
    const reindex = /** @type {{ reindex?: { reasons?: string[] } }} */ (result ?? {}).reindex;
    reindexNotice.value = reindex?.reasons ?? [];
    dialogVisible.value = false;
    await invalidate();
  },
  onError: (error) => {
    submitError.value = t(problemMessageKey(error));
  },
});

const preview = useMutation({
  mutationFn: () => previewFieldConversion(editing.value?.id ?? '', form.dataType, csrfToken.value),
  onSuccess: (result) => {
    conversion.value = /** @type {Record<string, unknown>} */ (result);
  },
  onError: (error) => {
    submitError.value = t(problemMessageKey(error));
  },
});

const archive = useMutation({
  /** @param {FieldDefinition} definition */
  mutationFn: (definition) =>
    archiveFieldDefinition(definition.id, definition.version, csrfToken.value),
  onSuccess: async (result) => {
    reindexNotice.value =
      /** @type {{ reindex?: { reasons?: string[] } }} */ (result ?? {}).reindex?.reasons ?? [];
    await invalidate();
  },
});

const addOption = useMutation({
  mutationFn: () =>
    createFieldOption(
      editing.value?.id ?? '',
      {
        expectedVersion: editing.value?.version ?? 0,
        key: optionDraft.key,
        labels: {
          en: optionDraft.en.trim(),
          ...(optionDraft.uk.trim() ? { uk: optionDraft.uk.trim() } : {}),
        },
        displayOrder: activeOptions.value.length,
      },
      csrfToken.value,
    ),
  onSuccess: async (result) => {
    editing.value = /** @type {FieldDefinition} */ (result);
    Object.assign(optionDraft, { key: '', en: '', uk: '' });
    await invalidate();
  },
  onError: (error) => {
    formErrors.option = t(problemMessageKey(error));
  },
});

const removeOption = useMutation({
  /** @param {FieldOption} option */
  mutationFn: (option) =>
    archiveFieldOption(
      editing.value?.id ?? '',
      option.id,
      editing.value?.version ?? 0,
      csrfToken.value,
    ),
  onSuccess: async (result) => {
    editing.value = /** @type {FieldDefinition} */ (result);
    await invalidate();
  },
  onError: (error) => {
    formErrors.option = t(problemMessageKey(error));
  },
});

function submitOption() {
  formErrors.option = '';
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(optionDraft.key) || !optionDraft.en.trim()) {
    formErrors.option = t('schema.validation.option');
    return;
  }
  addOption.mutate();
}

function submit() {
  submitError.value = '';
  if (validate()) save.mutate();
}

watch(scope, () => {
  dialogVisible.value = false;
  reindexNotice.value = [];
  resetForm();
});
watch(
  () => form.dataType,
  (dataType) => {
    conversion.value = null;
    if (dataType === rulesFor.value) return;
    rulesFor.value = dataType;
    form.rules = {};
    resetPreview();
  },
);
</script>

<template>
  <section class="stack field-designer">
    <div class="page-heading">
      <div>
        <h1>{{ t('routes.adminFields') }}</h1>
        <p>{{ t('schema.description') }}</p>
      </div>
      <AppButton @click="openCreate">{{ t('schema.create') }}</AppButton>
    </div>

    <AppField input-id="schema-scope" :label="t('schema.scope')">
      <AppSelect
        v-model="scope"
        input-id="schema-scope"
        :options="[
          { value: 'item', label: t('schema.scopes.item') },
          { value: 'storage_node', label: t('schema.scopes.storageNode') },
        ]"
        option-label="label"
        option-value="value"
      />
    </AppField>

    <p v-if="reindexNotice.length" class="reindex-warning" role="status">
      {{
        t('schema.reindexWarning', {
          reasons: reindexNotice.map((reason) => t(`schema.reindexReasons.${reason}`)).join(', '),
        })
      }}
    </p>

    <AppFormSection :title="t('schema.fields')">
      <AppDataView
        :items="fields"
        :loading="definitions.isLoading.value"
        :error="definitions.isError.value ? t('common.loadFailed') : ''"
      >
        <template #empty>{{ t('schema.empty') }}</template>
        <template #list="{ items }">
          <ul class="record-list">
            <li v-for="field in items" :key="field.id" :class="{ archived: field.archivedAt }">
              <div>
                <strong>{{ field.labels.en }}</strong>
                <span v-if="field.labels.uk"> / {{ field.labels.uk }}</span>
                <small class="record-meta">
                  {{ field.key }} · {{ t(`schema.dataTypes.${messageKey(field.dataType)}`) }} ·
                  {{ t(`schema.visibilities.${field.visibility}`) }}
                  <span v-if="field.required"> · {{ t('schema.flags.required') }}</span>
                  <span v-if="field.repeatable"> · {{ t('schema.flags.repeatable') }}</span>
                  <span v-if="field.searchable"> · {{ t('schema.flags.searchable') }}</span>
                  <span v-if="field.filterable"> · {{ t('schema.flags.filterable') }}</span>
                  <span v-if="field.sortable"> · {{ t('schema.flags.sortable') }}</span>
                  <span v-if="field.unit"> · {{ field.unit }}</span>
                  <span v-if="field.archivedAt"> · {{ t('schema.archived') }}</span>
                </small>
              </div>
              <div v-if="!field.archivedAt" class="record-actions">
                <AppButton variant="secondary" @click="openEdit(field)">
                  {{ t('schema.edit') }}
                </AppButton>
                <AppButton
                  variant="danger"
                  :loading="archive.isPending.value"
                  @click="archive.mutate(field)"
                >
                  {{ t('schema.archive') }}
                </AppButton>
              </div>
            </li>
          </ul>
        </template>
      </AppDataView>
    </AppFormSection>

    <AppDialog
      v-model:visible="dialogVisible"
      :title="editing ? t('schema.edit') : t('schema.create')"
    >
      <form class="stack" @submit.prevent="submit">
        <AppField input-id="field-key" :label="t('schema.key')" :error="formErrors.key">
          <AppInput
            id="field-key"
            v-model="form.key"
            :disabled="Boolean(editing)"
            :invalid="Boolean(formErrors.key)"
            required
          />
        </AppField>
        <AppField input-id="field-label-en" :label="t('schema.labelEn')" :error="formErrors.en">
          <AppInput
            id="field-label-en"
            v-model="form.en"
            :invalid="Boolean(formErrors.en)"
            required
          />
        </AppField>
        <AppField input-id="field-label-uk" :label="t('schema.labelUk')">
          <AppInput id="field-label-uk" v-model="form.uk" />
        </AppField>
        <AppField input-id="field-help-en" :label="t('schema.helpEn')">
          <AppInput id="field-help-en" v-model="form.helpEn" />
        </AppField>
        <AppField input-id="field-help-uk" :label="t('schema.helpUk')">
          <AppInput id="field-help-uk" v-model="form.helpUk" />
        </AppField>
        <AppField input-id="field-data-type" :label="t('schema.dataType')">
          <AppSelect
            v-model="form.dataType"
            input-id="field-data-type"
            :options="dataTypeOptions"
            option-label="label"
            option-value="value"
          />
        </AppField>
        <AppField input-id="field-category" :label="t('schema.applicability')">
          <AppSelect
            v-model="form.categoryId"
            input-id="field-category"
            :options="categoryOptions"
            option-label="label"
            option-value="value"
          />
        </AppField>
        <AppField input-id="field-visibility" :label="t('schema.visibility')">
          <AppSelect
            v-model="form.visibility"
            input-id="field-visibility"
            :options="visibilityOptions"
            option-label="label"
            option-value="value"
          />
        </AppField>
        <AppField
          v-for="flag in flagNames"
          :key="flag"
          :input-id="`field-flag-${flag}`"
          :label="t(`schema.flags.${flag}`)"
        >
          <AppSelect
            v-model="form[flag]"
            :input-id="`field-flag-${flag}`"
            :options="booleanOptions"
            :disabled="flag === 'repeatable' && repeatableLocked"
            option-label="label"
            option-value="value"
          />
        </AppField>
        <p v-if="repeatableLocked" class="record-meta">{{ t('schema.repeatableLocked') }}</p>
        <AppField input-id="field-unit" :label="t('schema.unit')" :error="formErrors.unit">
          <AppInput id="field-unit" v-model="form.unit" :invalid="Boolean(formErrors.unit)" />
        </AppField>
        <AppField
          input-id="field-order"
          :label="t('schema.displayOrder')"
          :error="formErrors.displayOrder"
        >
          <AppInput
            id="field-order"
            v-model="form.displayOrder"
            type="number"
            min="0"
            :invalid="Boolean(formErrors.displayOrder)"
            required
          />
        </AppField>

        <AppFormSection v-if="applicableRules.length" :title="t('schema.validationRules')">
          <AppField
            v-for="rule in applicableRules"
            :key="rule"
            :input-id="`field-rule-${rule}`"
            :label="t(`schema.rules.${rule}`)"
          >
            <AppInput :id="`field-rule-${rule}`" v-model="form.rules[rule]" />
          </AppField>
        </AppFormSection>

        <AppFormSection :title="t('schema.preview')">
          <p class="record-meta">{{ t('schema.previewHint') }}</p>
          <AppField input-id="field-preview" :label="form.en || t('schema.preview')">
            <AppTextarea
              v-if="form.dataType === 'long_text'"
              id="field-preview"
              v-model="defaultDraft.text"
              rows="3"
            />
            <AppDateField
              v-else-if="form.dataType === 'date' || form.dataType === 'datetime'"
              v-model="defaultDraft.date"
              input-id="field-preview"
              :show-time="form.dataType === 'datetime'"
            />
            <AppMoneyField
              v-else-if="form.dataType === 'money'"
              v-model="defaultDraft.money"
              input-id="field-preview"
              :currency="defaultDraft.currency"
            />
            <AppSelect
              v-else-if="form.dataType === 'boolean'"
              v-model="defaultDraft.boolean"
              input-id="field-preview"
              :options="booleanOptions"
              option-label="label"
              option-value="value"
            />
            <AppSelect
              v-else-if="form.dataType === 'select'"
              v-model="defaultDraft.option"
              input-id="field-preview"
              :options="previewOptions"
              option-label="label"
              option-value="value"
            />
            <AppMultiSelect
              v-else-if="form.dataType === 'multiselect'"
              v-model="defaultDraft.options"
              input-id="field-preview"
              :options="previewOptions"
              option-label="label"
              option-value="value"
            />
            <AppInput
              v-else
              id="field-preview"
              v-model="defaultDraft.text"
              :type="form.dataType === 'number' ? 'number' : 'text'"
            />
          </AppField>
          <AppField
            v-if="form.dataType === 'money'"
            input-id="field-preview-currency"
            :label="t('schema.currency')"
          >
            <AppInput id="field-preview-currency" v-model="defaultDraft.currency" maxlength="3" />
          </AppField>
          <p v-if="usesOptions" class="record-meta">{{ t('schema.optionDefaultUnsupported') }}</p>
        </AppFormSection>

        <AppFormSection v-if="editing && usesOptions" :title="t('schema.options')">
          <ul class="record-list">
            <li v-for="option in activeOptions" :key="option.id">
              <div>
                <strong>{{ option.labels.en }}</strong>
                <span v-if="option.labels.uk"> / {{ option.labels.uk }}</span>
                <small class="record-meta">{{ option.key }}</small>
              </div>
              <AppButton
                variant="danger"
                :loading="removeOption.isPending.value"
                @click="removeOption.mutate(option)"
              >
                {{ t('schema.archive') }}
              </AppButton>
            </li>
          </ul>
          <AppField input-id="option-key" :label="t('schema.optionKey')" :error="formErrors.option">
            <AppInput id="option-key" v-model="optionDraft.key" />
          </AppField>
          <AppField input-id="option-label-en" :label="t('schema.labelEn')">
            <AppInput id="option-label-en" v-model="optionDraft.en" />
          </AppField>
          <AppField input-id="option-label-uk" :label="t('schema.labelUk')">
            <AppInput id="option-label-uk" v-model="optionDraft.uk" />
          </AppField>
          <AppButton
            variant="secondary"
            :loading="addOption.isPending.value"
            @click="submitOption"
            >{{ t('schema.addOption') }}</AppButton
          >
        </AppFormSection>

        <AppFormSection v-if="conversionRequired" :title="t('schema.conversion')">
          <p class="record-meta">{{ t('schema.conversionHint') }}</p>
          <AppButton
            variant="secondary"
            :loading="preview.isPending.value"
            @click="preview.mutate()"
            >{{ t('schema.conversionPreview') }}</AppButton
          >
          <dl v-if="conversion" class="conversion-preview">
            <dt>{{ t('schema.conversionSupported') }}</dt>
            <dd>{{ conversion.supported ? t('common.yes') : t('common.no') }}</dd>
            <dt>{{ t('schema.conversionTotal') }}</dt>
            <dd>{{ conversion.totalValues }}</dd>
            <dt>{{ t('schema.conversionConvertible') }}</dt>
            <dd>{{ conversion.convertibleValues }}</dd>
            <dt>{{ t('schema.conversionBlocking') }}</dt>
            <dd>{{ conversion.blockingValues }}</dd>
            <dt v-if="conversion.requiresBackgroundConversion">
              {{ t('schema.conversionBackground') }}
            </dt>
            <dd v-if="conversion.requiresBackgroundConversion">{{ t('common.yes') }}</dd>
          </dl>
        </AppFormSection>

        <p v-if="submitError" role="alert">{{ submitError }}</p>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="dialogVisible = false">
          {{ t('schema.cancel') }}
        </AppButton>
        <AppButton :loading="save.isPending.value" @click="submit">{{
          t('schema.save')
        }}</AppButton>
      </template>
    </AppDialog>
  </section>
</template>
