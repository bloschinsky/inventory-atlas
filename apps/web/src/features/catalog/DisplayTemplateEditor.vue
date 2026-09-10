<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuery } from '@tanstack/vue-query';
import { AppButton, AppField, AppInput } from '../../shared/ui/index.js';
import { listFieldDefinitions, schemaKeys } from '../schema/api.js';
import { catalogKeys, previewCategoryDisplayName } from './api.js';
import { fieldErrorsFromProblem } from '../../shared/lib/form-errors.js';

/**
 * @typedef {{ id: string, key: string, labels: { en: string, uk?: string }, dataType: string,
 *   visibility: string, defaultValue?: unknown }} FieldDefinition
 */

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** Saved category the template belongs to; preview needs a persisted category. */
  categoryId: { type: String, default: '' },
  csrfToken: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
const { t, locale } = useI18n();

/** Core tokens and eligible data types mirror the server-side grammar. */
const coreTokens = ['category', 'status'];
/** Grammar example; token syntax is the same in every locale, so it is not a translated string. */
const templateExample = '{{brand}} {{model}} - {{condition}}';
const eligibleDataTypes = [
  'text',
  'long_text',
  'url',
  'email',
  'number',
  'date',
  'datetime',
  'select',
  'multiselect',
  'money',
];

const sample = ref(/** @type {Record<string, string>} */ ({}));
const debounced = ref(props.modelValue);
let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);

const definitionsQuery = useQuery({
  queryKey: computed(() => schemaKeys.fieldsForCategory(props.categoryId)),
  queryFn: () =>
    listFieldDefinitions('item', { categoryId: props.categoryId, includeArchived: false }),
  enabled: computed(() => Boolean(props.categoryId)),
});
const definitions = computed(
  () => /** @type {FieldDefinition[]} */ (definitionsQuery.data.value ?? []),
);
const fieldTokens = computed(() =>
  definitions.value.filter(
    (definition) =>
      definition.visibility !== 'private' && eligibleDataTypes.includes(definition.dataType),
  ),
);
const usedFieldTokens = computed(() =>
  fieldTokens.value.filter((definition) =>
    new RegExp(`\\{\\{\\s*${definition.key}\\s*\\}\\}`, 'u').test(props.modelValue),
  ),
);

const previewQuery = useQuery({
  queryKey: computed(() => [
    ...catalogKeys.categories,
    'display-name-preview',
    props.categoryId,
    debounced.value,
    JSON.stringify(sample.value),
  ]),
  queryFn: () =>
    previewCategoryDisplayName(
      props.categoryId,
      debounced.value.trim(),
      usedSample(),
      props.csrfToken,
    ),
  enabled: computed(() => Boolean(props.categoryId) && Boolean(debounced.value.trim())),
  retry: false,
});

const preview = computed(
  () => /** @type {Record<string, any>|null} */ (previewQuery.data.value ?? null),
);
/** Stable issue codes the server reported for the current draft. */
const issues = computed(() => {
  const error = previewQuery.error.value;
  if (!error) return [];
  const mapped = fieldErrorsFromProblem(
    error && typeof error === 'object' && 'detail' in error ? error.detail : null,
  );
  return String(mapped.displayTemplate ?? '')
    .split(' ')
    .filter(Boolean);
});

/** One localized message per reported issue; the field renders them as its single alert. */
const issueMessages = computed(() => issues.value.map((code) => issueMessage(code)));

watch(
  () => props.modelValue,
  (next) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = next;
    }, 250);
  },
  { immediate: true },
);
watch(fieldTokens, (next) => {
  for (const definition of next) {
    if (sample.value[definition.key] !== undefined) continue;
    const stored = Array.isArray(definition.defaultValue)
      ? definition.defaultValue[0]
      : definition.defaultValue;
    if (stored !== null && stored !== undefined && typeof stored !== 'object')
      sample.value = { ...sample.value, [definition.key]: String(stored) };
  }
});

function usedSample() {
  return Object.fromEntries(
    usedFieldTokens.value.flatMap((definition) => {
      const value = sample.value[definition.key]?.trim();
      return value ? [[definition.key, value]] : [];
    }),
  );
}

/** @param {{ en?: string, uk?: string }|null|undefined} value */
function localized(value) {
  const key = /** @type {'en'|'uk'} */ (locale.value);
  return value?.[key] || value?.en || '';
}

/** @param {string} key */
function insertToken(key) {
  const separator = props.modelValue && !props.modelValue.endsWith(' ') ? ' ' : '';
  emit('update:modelValue', `${props.modelValue}${separator}{{${key}}}`);
}

/**
 * Maps a stable server issue code such as `TEMPLATE_PRIVATE_TOKEN:owner_note` to its localized
 * message. API prose is never shown; only the code selects the wording.
 * @param {string} code
 */
function issueMessage(code) {
  const [issue, token] = code.split(':');
  const key = issue
    .replace('TEMPLATE_', '')
    .toLowerCase()
    .replace(/_(.)/gu, (_match, letter) => letter.toUpperCase());
  const message = t(`catalog.templateIssues.${key}`);
  return token ? `${message} (${token})` : message;
}

/** @param {string} key @param {string} value */
function setSample(key, value) {
  sample.value = { ...sample.value, [key]: value };
}
</script>

<template>
  <div class="template-editor">
    <AppField
      input-id="dictionary-template"
      :label="t('catalog.displayTemplate')"
      :error="issueMessages.join(' ')"
    >
      <AppInput
        id="dictionary-template"
        :model-value="modelValue"
        :invalid="issues.length > 0"
        :placeholder="templateExample"
        :aria-describedby="'dictionary-template-help'"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </AppField>
    <p id="dictionary-template-help" class="template-editor__help">
      {{ t('catalog.displayTemplateHelp') }}
    </p>

    <div class="template-editor__tokens" :aria-label="t('catalog.templateTokens')">
      <AppButton
        v-for="token in coreTokens"
        :key="token"
        type="button"
        variant="secondary"
        @click="insertToken(token)"
      >
        {{ t(`catalog.coreTokens.${token}`) }}
      </AppButton>
      <AppButton
        v-for="definition in fieldTokens"
        :key="definition.id"
        type="button"
        variant="secondary"
        @click="insertToken(definition.key)"
      >
        {{ localized(definition.labels) }}
      </AppButton>
      <p v-if="categoryId && !fieldTokens.length" class="template-editor__help">
        {{ t('catalog.templateNoFields') }}
      </p>
    </div>

    <template v-if="usedFieldTokens.length">
      <p class="template-editor__help">{{ t('catalog.templateSampleHint') }}</p>
      <div class="template-editor__samples">
        <AppField
          v-for="definition in usedFieldTokens"
          :key="definition.id"
          :input-id="`template-sample-${definition.key}`"
          :label="localized(definition.labels)"
        >
          <AppInput
            :id="`template-sample-${definition.key}`"
            :model-value="sample[definition.key] ?? ''"
            @update:model-value="setSample(definition.key, $event)"
          />
        </AppField>
      </div>
    </template>

    <section v-if="!categoryId" class="template-editor__preview">
      <p class="template-editor__help">{{ t('catalog.templatePreviewAfterSave') }}</p>
    </section>
    <section v-else-if="preview" class="template-editor__preview" aria-live="polite">
      <h4>{{ t('catalog.templatePreview') }}</h4>
      <dl>
        <dt>{{ t('locale.en') }}</dt>
        <dd>{{ preview.rendered.en || t('catalog.templatePreviewEmpty') }}</dd>
        <dt>{{ t('locale.uk') }}</dt>
        <dd>{{ preview.rendered.uk || t('catalog.templatePreviewEmpty') }}</dd>
      </dl>
      <p v-if="preview.missingTokens.length" class="template-editor__help">
        {{ t('catalog.templateSkipped', { tokens: preview.missingTokens.join(', ') }) }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.template-editor {
  display: grid;
  gap: var(--ia-space-3);
}
.template-editor__help {
  margin: 0;
  color: var(--ia-color-text-muted);
}
.template-editor__tokens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ia-space-2);
}
.template-editor__samples {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ia-space-3);
}
.template-editor__preview {
  padding: var(--ia-space-3);
  border: 1px solid var(--ia-color-border);
  border-radius: var(--ia-radius-md);
  background: var(--ia-color-surface-50);
}
.template-editor__preview h4,
.template-editor__preview dl {
  margin: 0;
}
.template-editor__preview dl {
  display: grid;
  grid-template-columns: minmax(4rem, auto) minmax(0, 1fr);
  gap: var(--ia-space-1) var(--ia-space-3);
  margin-block-start: var(--ia-space-2);
}
.template-editor__preview dd {
  margin: 0;
  overflow-wrap: anywhere;
}
@media (max-width: 720px) {
  .template-editor__samples {
    grid-template-columns: 1fr;
  }
}
</style>
