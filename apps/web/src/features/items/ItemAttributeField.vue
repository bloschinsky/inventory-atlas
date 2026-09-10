<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AppButton,
  AppDateField,
  AppField,
  AppInput,
  AppMoneyField,
  AppMultiSelect,
  AppSelect,
  AppTextarea,
} from '../../shared/ui/index.js';

/**
 * @typedef {{ id: string, labels: { en: string, uk?: string }, archivedAt?: string|null }} FieldOption
 * @typedef {{ key: string, labels: { en: string, uk?: string }, help?: { en?: string, uk?: string }|null,
 *   dataType: string, required: boolean, repeatable: boolean, unit?: string|null,
 *   options?: FieldOption[] }} FieldDefinition
 */

const props = defineProps({
  definition: { type: Object, required: true },
  error: { type: String, default: '' },
  modelValue: {
    type: /** @type {import('vue').PropType<any>} */ ([
      String,
      Number,
      Boolean,
      Array,
      Object,
      Date,
    ]),
    default: null,
  },
});
const emit = defineEmits(['update:modelValue']);
const { t, locale } = useI18n();
const definition = /** @type {FieldDefinition} */ (props.definition);

const label = computed(() => localized(definition.labels));
const help = computed(() => localized(definition.help));
const options = computed(() =>
  (definition.options ?? [])
    .filter((/** @type {FieldOption} */ option) => !option.archivedAt)
    .map((/** @type {FieldOption} */ option) => ({
      value: option.id,
      label: localized(option.labels),
    })),
);
const booleanOptions = computed(() => [
  { value: true, label: t('common.yes') },
  { value: false, label: t('common.no') },
]);
const referenceScopes = computed(() => [
  { value: 'item', label: t('items.referenceItem') },
  { value: 'storage_node', label: t('items.referenceStorage') },
]);
const rows = computed(() =>
  props.definition.repeatable
    ? Array.isArray(props.modelValue)
      ? props.modelValue
      : []
    : [props.modelValue],
);

/** @param {{ en?: string, uk?: string }|null|undefined} value */
function localized(value) {
  const key = /** @type {'en'|'uk'} */ (locale.value);
  return value?.[key] || value?.en || '';
}

function emptyValue() {
  if (props.definition.dataType === 'boolean') return null;
  if (props.definition.dataType === 'date' || props.definition.dataType === 'datetime') return null;
  if (props.definition.dataType === 'money') return { amount: null, currency: 'UAH' };
  if (props.definition.dataType === 'reference') return { scope: 'item', id: '' };
  return '';
}

/** @param {number} index @param {unknown} value */
function updateRow(index, value) {
  if (!props.definition.repeatable) {
    emit('update:modelValue', value);
    return;
  }
  const next = [...rows.value];
  next[index] = value;
  emit('update:modelValue', next);
}

function addRow() {
  emit('update:modelValue', [...rows.value, emptyValue()]);
}

/** @param {number} index */
function removeRow(index) {
  emit(
    'update:modelValue',
    rows.value.filter((_, rowIndex) => rowIndex !== index),
  );
}

/** @param {number} index @param {'amount'|'currency'} key @param {unknown} value */
function updateMoney(index, key, value) {
  const current = rows.value[index];
  updateRow(index, {
    amount: current && typeof current === 'object' && 'amount' in current ? current.amount : null,
    currency:
      current && typeof current === 'object' && 'currency' in current ? current.currency : 'UAH',
    [key]: value,
  });
}

/** @param {number} index @param {'scope'|'id'} key @param {unknown} value */
function updateReference(index, key, value) {
  const current = rows.value[index];
  updateRow(index, {
    scope: current && typeof current === 'object' && 'scope' in current ? current.scope : 'item',
    id: current && typeof current === 'object' && 'id' in current ? current.id : '',
    [key]: value,
  });
}
</script>

<template>
  <AppField
    :input-id="`attribute-${definition.key}`"
    :label="`${label}${definition.required ? ' *' : ''}${definition.unit ? ` (${definition.unit})` : ''}`"
    :error="error"
  >
    <p v-if="help" :id="`attribute-${definition.key}-help`" class="item-field-help">{{ help }}</p>
    <AppMultiSelect
      v-if="definition.dataType === 'multiselect'"
      :input-id="`attribute-${definition.key}`"
      :model-value="Array.isArray(modelValue) ? modelValue : []"
      :options="options"
      option-label="label"
      option-value="value"
      :invalid="Boolean(error)"
      :aria-label="label"
      :aria-describedby="help ? `attribute-${definition.key}-help` : undefined"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div v-else class="item-field-values">
      <div v-for="(value, index) in rows" :key="index" class="item-field-value">
        <AppTextarea
          v-if="definition.dataType === 'long_text'"
          :id="`attribute-${definition.key}-${index}`"
          :model-value="typeof value === 'string' ? value : ''"
          :invalid="Boolean(error)"
          :aria-label="label"
          rows="3"
          @update:model-value="updateRow(index, $event)"
        />
        <AppSelect
          v-else-if="definition.dataType === 'boolean'"
          :input-id="`attribute-${definition.key}-${index}`"
          :model-value="value"
          :options="booleanOptions"
          option-label="label"
          option-value="value"
          :invalid="Boolean(error)"
          :aria-label="label"
          @update:model-value="updateRow(index, $event)"
        />
        <AppDateField
          v-else-if="definition.dataType === 'date' || definition.dataType === 'datetime'"
          :input-id="`attribute-${definition.key}-${index}`"
          :model-value="value instanceof Date ? value : null"
          :show-time="definition.dataType === 'datetime'"
          :hour-format="definition.dataType === 'datetime' ? '24' : undefined"
          :invalid="Boolean(error)"
          :aria-label="label"
          @update:model-value="updateRow(index, $event)"
        />
        <AppSelect
          v-else-if="definition.dataType === 'select'"
          :input-id="`attribute-${definition.key}-${index}`"
          :model-value="value"
          :options="options"
          option-label="label"
          option-value="value"
          :invalid="Boolean(error)"
          :aria-label="label"
          @update:model-value="updateRow(index, $event)"
        />
        <div v-else-if="definition.dataType === 'money'" class="item-money-value">
          <AppMoneyField
            :input-id="`attribute-${definition.key}-${index}`"
            :model-value="
              value && typeof value === 'object' && 'amount' in value ? value.amount : null
            "
            :currency="
              value && typeof value === 'object' && 'currency' in value ? value.currency : 'UAH'
            "
            :invalid="Boolean(error)"
            :aria-label="label"
            @update:model-value="updateMoney(index, 'amount', $event)"
          />
          <AppInput
            :aria-label="t('schema.currency')"
            :model-value="
              value && typeof value === 'object' && 'currency' in value ? value.currency : 'UAH'
            "
            maxlength="3"
            @update:model-value="updateMoney(index, 'currency', $event.toUpperCase())"
          />
        </div>
        <div v-else-if="definition.dataType === 'reference'" class="item-reference-value">
          <AppSelect
            :aria-label="t('items.referenceType')"
            :model-value="
              value && typeof value === 'object' && 'scope' in value ? value.scope : 'item'
            "
            :options="referenceScopes"
            option-label="label"
            option-value="value"
            @update:model-value="updateReference(index, 'scope', $event)"
          />
          <AppInput
            :id="`attribute-${definition.key}-${index}`"
            :model-value="value && typeof value === 'object' && 'id' in value ? value.id : ''"
            :invalid="Boolean(error)"
            @update:model-value="updateReference(index, 'id', $event)"
          />
        </div>
        <AppInput
          v-else
          :id="`attribute-${definition.key}-${index}`"
          :model-value="typeof value === 'string' || typeof value === 'number' ? String(value) : ''"
          :type="
            definition.dataType === 'email'
              ? 'email'
              : definition.dataType === 'url'
                ? 'url'
                : definition.dataType === 'number'
                  ? 'number'
                  : 'text'
          "
          :invalid="Boolean(error)"
          :aria-label="label"
          @update:model-value="updateRow(index, $event)"
        />
        <AppButton
          v-if="definition.repeatable"
          type="button"
          variant="secondary"
          :aria-label="t('items.removeValue', { field: label })"
          @click="removeRow(index)"
          >{{ t('items.remove') }}</AppButton
        >
      </div>
      <AppButton v-if="definition.repeatable" type="button" variant="secondary" @click="addRow">
        {{ t('items.addValue') }}
      </AppButton>
    </div>
  </AppField>
</template>

<style scoped>
.item-field-help {
  margin: 0;
  color: var(--ia-color-text-muted);
}
.item-field-values {
  display: grid;
  gap: var(--ia-space-2);
}
.item-field-value,
.item-money-value,
.item-reference-value {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--ia-space-2);
}
.item-money-value,
.item-reference-value {
  grid-template-columns: minmax(0, 1fr) minmax(7rem, 0.35fr);
}
@media (max-width: 520px) {
  .item-money-value,
  .item-reference-value {
    grid-template-columns: 1fr;
  }
}
</style>
