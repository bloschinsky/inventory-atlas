<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AppBreadcrumb } from '../../shared/ui/index.js';

const props = defineProps({
  item: { type: Object, required: true },
  definitions: { type: Array, default: () => [] },
  category: { type: Object, default: null },
  lifecycleStatus: { type: Object, default: null },
  breadcrumb: { type: Array, default: () => [] },
  publicBreadcrumb: { type: Array, default: () => [] },
  canViewPrivatePath: Boolean,
});
const { t, locale, d } = useI18n();

const categoryLabel = computed(
  () => localized(props.category?.labels) || t('items.unknownCategory'),
);
const statusLabel = computed(
  () => localized(props.lifecycleStatus?.labels) || t('items.unknownStatus'),
);
const placeholderInitial = computed(() => categoryLabel.value.trim().charAt(0).toLocaleUpperCase());
const visibleBreadcrumb = computed(() =>
  props.canViewPrivatePath ? props.breadcrumb : props.publicBreadcrumb,
);
const attributeRows = computed(() =>
  /** @type {Record<string, unknown>[]} */ (props.definitions)
    .filter((definition) => {
      const key = String(definition.key);
      return props.item.attributes?.[key] !== undefined;
    })
    .map((definition) => {
      const key = String(definition.key);
      return {
        key,
        label: localized(/** @type {{ en?: string, uk?: string }} */ (definition.labels)),
        value: formatValue(definition, props.item.attributes[key]),
      };
    }),
);

/** @param {{ en?: string, uk?: string }|null|undefined} value */
function localized(value) {
  const key = /** @type {'en'|'uk'} */ (locale.value);
  return value?.[key] || value?.en || '';
}

/** @param {Record<string, unknown>} definition @param {unknown} value */
function formatValue(definition, value) {
  const values = Array.isArray(value) ? value : [value];
  const formatted = values.map((entry) => formatSingle(definition, entry));
  return formatted.filter(Boolean).join(', ');
}

/** @param {Record<string, unknown>} definition @param {unknown} value */
function formatSingle(definition, value) {
  if (value === null || value === undefined || value === '') return '';
  if (definition.dataType === 'boolean') return value ? t('common.yes') : t('common.no');
  if (definition.dataType === 'date' || definition.dataType === 'datetime') {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : d(date, 'short');
  }
  if (definition.dataType === 'select' || definition.dataType === 'multiselect') {
    const options = Array.isArray(definition.options)
      ? /** @type {Record<string, unknown>[]} */ (definition.options)
      : [];
    const option = options.find((entry) => entry.id === value);
    return (
      localized(/** @type {{ en?: string, uk?: string }|undefined} */ (option?.labels)) ||
      String(value)
    );
  }
  if (definition.dataType === 'money' && typeof value === 'object') {
    const money = /** @type {{ amount?: string|number, currency?: string }} */ (value);
    return `${money.amount ?? ''} ${money.currency ?? ''}`.trim();
  }
  if (definition.dataType === 'reference' && typeof value === 'object') {
    const reference = /** @type {{ id?: string }} */ (value);
    return reference.id ?? '';
  }
  return String(value);
}
</script>

<template>
  <article class="item-card" :aria-labelledby="`item-${item.publicId}`">
    <div
      class="item-card__media"
      role="img"
      :aria-label="t('items.placeholderMedia', { category: categoryLabel })"
    >
      <span aria-hidden="true">{{ placeholderInitial || '?' }}</span>
    </div>
    <div class="item-card__body">
      <header>
        <p class="item-card__category">{{ categoryLabel }}</p>
        <h1 :id="`item-${item.publicId}`">{{ item.displayName }}</h1>
        <p class="item-card__status">
          {{ statusLabel }} · {{ t(`items.visibilities.${item.visibility}`) }}
        </p>
      </header>

      <section v-if="visibleBreadcrumb.length" :aria-label="t('items.location')">
        <AppBreadcrumb :items="visibleBreadcrumb" />
      </section>
      <p v-else class="item-card__muted">{{ t('items.noLocation') }}</p>

      <p v-if="item.description" class="item-card__description">{{ item.description }}</p>

      <dl v-if="attributeRows.length" class="item-card__attributes">
        <template v-for="attribute in attributeRows" :key="attribute.key">
          <dt>{{ attribute.label }}</dt>
          <dd>{{ attribute.value }}</dd>
        </template>
      </dl>

      <div v-if="item.tags?.length" class="item-card__tags" :aria-label="t('items.tags')">
        <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
      </div>
      <small class="item-card__muted">{{ t('items.publicId') }}: {{ item.publicId }}</small>
    </div>
  </article>
</template>

<style scoped>
.item-card {
  display: grid;
  grid-template-columns: minmax(11rem, 0.38fr) minmax(0, 1fr);
  gap: var(--ia-space-6);
  padding: var(--ia-space-4);
  border: 1px solid var(--ia-color-border);
  border-radius: var(--ia-radius-lg);
  background: var(--ia-color-surface-0);
}
.item-card__media {
  min-height: 14rem;
  display: grid;
  place-items: center;
  border-radius: var(--ia-radius-md);
  color: var(--ia-color-brand-700);
  background: var(--ia-color-brand-100);
  font-size: clamp(3rem, 12vw, 7rem);
  font-weight: 700;
}
.item-card__body {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: var(--ia-space-4);
}
.item-card h1,
.item-card p,
.item-card dl {
  margin: 0;
}
.item-card__category {
  color: var(--ia-color-brand-700);
  font-weight: 700;
}
.item-card__status,
.item-card__muted {
  color: var(--ia-color-text-muted);
}
.item-card__description {
  white-space: pre-wrap;
}
.item-card__attributes {
  display: grid;
  grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
  gap: var(--ia-space-2) var(--ia-space-4);
}
.item-card__attributes dt {
  font-weight: 700;
}
.item-card__attributes dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.item-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ia-space-2);
}
.item-card__tags span {
  padding: var(--ia-space-1) var(--ia-space-2);
  border-radius: 999px;
  background: var(--ia-color-surface-100);
}
@media (max-width: 720px) {
  .item-card {
    grid-template-columns: 1fr;
  }
  .item-card__media {
    min-height: 10rem;
  }
  .item-card__attributes {
    grid-template-columns: 1fr;
  }
  .item-card__attributes dd + dt {
    margin-top: var(--ia-space-2);
  }
}
</style>
