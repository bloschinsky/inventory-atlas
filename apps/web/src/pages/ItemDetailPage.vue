<script setup>
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AppButton,
  AppDialog,
  AppField,
  AppFormSection,
  AppSelect,
  AppTextarea,
} from '../shared/ui/index.js';
import { catalogKeys, listDictionary } from '../features/catalog/api.js';
import { getItem, itemKeys, listItemMovements, moveItem } from '../features/items/api.js';
import ItemCard from '../features/items/ItemCard.vue';
import { listItemMedia, mediaKeys } from '../features/media/api.js';
import { listFieldDefinitions, schemaKeys } from '../features/schema/api.js';
import { listStorageDestinations, storageKeys } from '../features/storage/api.js';
import { useSessionContext } from '../shared/auth/session-context.js';
import { problemMessageKey } from '../shared/lib/problem-message.js';

const { t, d } = useI18n();
const route = useRoute();
const session = useSessionContext();
const queryClient = useQueryClient();
const publicId = computed(() => String(route.params.publicId ?? ''));
const canMove = computed(() => session.summary?.permissions?.includes('moveInventory') ?? false);
const canViewPrivate = computed(
  () => session.summary?.permissions?.includes('viewPrivateFields') ?? false,
);
const historyCursor = ref(/** @type {string|null} */ (null));
const moveDialogVisible = ref(false);
const destinationId = ref('');
const moveReason = ref('');
const moveError = ref('');
const requestKey = ref(crypto.randomUUID());

const itemQuery = useQuery({
  queryKey: computed(() => itemKeys.detail(publicId.value)),
  queryFn: () => getItem(publicId.value),
  enabled: computed(() => Boolean(session.summary && publicId.value)),
});
const item = computed(() => itemQuery.data.value ?? null);
const categories = useQuery({
  queryKey: [...catalogKeys.categories, 'active'],
  queryFn: () => listDictionary('categories', false),
  enabled: computed(() => Boolean(item.value)),
});
const statuses = useQuery({
  queryKey: [...catalogKeys.statuses, 'active'],
  queryFn: () => listDictionary('lifecycle-statuses', false),
  enabled: computed(() => Boolean(item.value)),
});
const definitions = useQuery({
  queryKey: computed(() => schemaKeys.fieldsForCategory(item.value?.categoryId ?? '')),
  queryFn: () =>
    listFieldDefinitions('item', {
      categoryId: String(item.value?.categoryId ?? ''),
      includeArchived: false,
    }),
  enabled: computed(() => Boolean(item.value?.categoryId)),
});
const media = useQuery({
  queryKey: computed(() => mediaKeys.forItem(publicId.value)),
  queryFn: () => listItemMedia(publicId.value),
  enabled: computed(() => Boolean(item.value)),
});
const movements = useQuery({
  queryKey: computed(() => [...itemKeys.movements(publicId.value), historyCursor.value]),
  queryFn: () => listItemMovements(publicId.value, { limit: 25, cursor: historyCursor.value }),
  enabled: computed(() => Boolean(item.value)),
});
const destinations = useQuery({
  queryKey: storageKeys.destinations,
  queryFn: listStorageDestinations,
  enabled: computed(() => canMove.value && moveDialogVisible.value),
});

const category = computed(() =>
  /** @type {Record<string, any>[]} */ (categories.data.value ?? []).find(
    (/** @type {Record<string, any>} */ entry) => entry.id === item.value?.categoryId,
  ),
);
const lifecycleStatus = computed(() =>
  /** @type {Record<string, any>[]} */ (statuses.data.value ?? []).find(
    (/** @type {Record<string, any>} */ entry) => entry.id === item.value?.lifecycleStatusId,
  ),
);
const breadcrumb = computed(() =>
  String(item.value?.locationPath ?? '')
    .split(' / ')
    .filter(Boolean)
    .map((label) => ({ label })),
);
const destinationOptions = computed(() => [
  { value: '', label: t('items.noLocation') },
  ...(destinations.data.value ?? [])
    .filter((node) => node.publicId !== item.value?.storageNodeId)
    .map((node) => ({ value: node.publicId, label: node.pathLabel })),
]);

const moveMutation = useMutation({
  mutationFn: () =>
    moveItem(
      publicId.value,
      Number(item.value?.version),
      {
        storageNodeId: destinationId.value || null,
        ...(moveReason.value.trim() ? { reason: moveReason.value.trim() } : {}),
      },
      session.summary?.csrfToken ?? '',
      requestKey.value,
    ),
  onSuccess: async (updated) => {
    queryClient.setQueryData(itemKeys.detail(publicId.value), { ...item.value, ...updated });
    moveDialogVisible.value = false;
    moveError.value = '';
    destinationId.value = '';
    moveReason.value = '';
    requestKey.value = crypto.randomUUID();
    historyCursor.value = null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: itemKeys.movements(publicId.value) }),
      queryClient.invalidateQueries({ queryKey: storageKeys.all }),
    ]);
  },
  onError: (error) => {
    moveError.value = t(problemMessageKey(error));
  },
});

function openMove() {
  destinationId.value = String(item.value?.storageNodeId ?? '');
  moveReason.value = '';
  moveError.value = '';
  requestKey.value = crypto.randomUUID();
  moveDialogVisible.value = true;
}

/** @param {Record<string, unknown>} movement */
function movementSummary(movement) {
  if (movement.fromPathSnapshot || movement.toPathSnapshot)
    return t('items.movement.path', {
      from: movement.fromPathSnapshot || t('items.noLocation'),
      to: movement.toPathSnapshot || t('items.noLocation'),
    });
  if (!movement.fromAssigned) return t('items.movement.assigned');
  if (!movement.toAssigned) return t('items.movement.unassigned');
  return t('items.movement.changedHidden');
}
</script>

<template>
  <section class="item-detail-page stack">
    <div v-if="!session.summary" class="auth-panel">
      <h1>{{ t('routes.itemDetail') }}</h1>
      <p role="alert">{{ t('problems.unauthorized') }}</p>
    </div>
    <p v-else-if="itemQuery.isLoading.value">{{ t('common.loading') }}</p>
    <p v-else-if="itemQuery.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
    <template v-else-if="item">
      <div class="page-heading">
        <p>{{ t('items.currentVersion', { version: item.version }) }}</p>
        <div class="item-actions">
          <RouterLink v-if="canMove" :to="`/items/${publicId}/edit`">{{
            t('items.edit')
          }}</RouterLink>
          <AppButton v-if="canMove" type="button" variant="secondary" @click="openMove">{{
            t('items.movement.action')
          }}</AppButton>
        </div>
      </div>

      <ItemCard
        :item="item"
        :media="media.data.value ?? []"
        :definitions="definitions.data.value ?? []"
        :category="category"
        :lifecycle-status="lifecycleStatus"
        :breadcrumb="breadcrumb"
        :public-breadcrumb="breadcrumb"
        :can-view-private-path="canViewPrivate"
      />

      <AppFormSection :title="t('items.movement.history')">
        <p v-if="movements.isLoading.value">{{ t('common.loading') }}</p>
        <p v-else-if="movements.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
        <ol v-else class="movement-history">
          <li
            v-for="movement in movements.data.value?.entries ?? []"
            :key="`${movement.occurredAt}:${movement.actorDisplayName}`"
          >
            <strong>{{ movementSummary(movement) }}</strong>
            <span
              >{{ movement.actorDisplayName }} ·
              {{ d(new Date(movement.occurredAt), 'short') }}</span
            >
            <p v-if="movement.reason">{{ movement.reason }}</p>
          </li>
          <li v-if="!movements.data.value?.entries?.length">{{ t('items.movement.empty') }}</li>
        </ol>
        <AppButton
          v-if="movements.data.value?.nextCursor"
          type="button"
          variant="secondary"
          @click="historyCursor = movements.data.value.nextCursor"
          >{{ t('common.next') }}</AppButton
        >
      </AppFormSection>

      <AppDialog v-model:visible="moveDialogVisible" :title="t('items.movement.title')">
        <div class="move-dialog stack">
          <p>{{ t('items.movement.description') }}</p>
          <p v-if="destinations.isLoading.value">{{ t('common.loading') }}</p>
          <p v-else-if="destinations.isError.value" role="alert">{{ t('common.loadFailed') }}</p>
          <template v-else>
            <AppField input-id="item-move-destination" :label="t('items.movement.destination')">
              <AppSelect
                v-model="destinationId"
                input-id="item-move-destination"
                :aria-label="t('items.movement.destination')"
                :options="destinationOptions"
                option-label="label"
                option-value="value"
              />
            </AppField>
            <AppField input-id="item-move-reason" :label="t('items.movement.reason')">
              <AppTextarea id="item-move-reason" v-model="moveReason" maxlength="512" rows="3" />
            </AppField>
          </template>
          <p v-if="moveError" role="alert">{{ moveError }}</p>
        </div>
        <template #footer>
          <AppButton
            type="button"
            :loading="moveMutation.isPending.value"
            @click="moveMutation.mutate()"
            >{{
              moveMutation.isPending.value
                ? t('items.movement.moving')
                : t('items.movement.confirm')
            }}</AppButton
          >
        </template>
      </AppDialog>
    </template>
  </section>
</template>

<style scoped>
.item-actions {
  display: flex;
  align-items: center;
  gap: var(--ia-space-3);
}
.movement-history {
  display: grid;
  gap: var(--ia-space-4);
  margin: 0;
  padding-inline-start: var(--ia-space-6);
}
.movement-history li {
  display: grid;
  gap: var(--ia-space-1);
}
.movement-history span {
  color: var(--ia-color-text-muted);
}
.movement-history p {
  margin: 0;
}
.move-dialog {
  min-width: min(32rem, 80vw);
}
@media (max-width: 720px) {
  .page-heading,
  .item-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .move-dialog {
    min-width: 0;
  }
}
</style>
