<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { AppButton, AppFileUpload } from '../../shared/ui/index.js';
import {
  beginMediaUpload,
  detachItemMedia,
  fileChecksum,
  finalizeMediaUpload,
  listItemMedia,
  mediaKeys,
  reorderItemMedia,
  setPrimaryItemMedia,
  uploadMediaContent,
} from './api.js';
import { problemMessageKey } from '../../shared/lib/problem-message.js';
import { fieldErrorsFromProblem } from '../../shared/lib/form-errors.js';

/**
 * @typedef {{ relationId: string, assetId: string, role: string, position: number,
 *   altText: string|null, originalFilename: string, contentUrl: string,
 *   processingState: string }} MediaItem
 */

const props = defineProps({
  itemPublicId: { type: String, required: true },
  /** Known Item version; every media mutation sends it so a stale page cannot reorder. */
  expectedVersion: { type: Number, default: 0 },
  csrfToken: { type: String, default: '' },
  canEdit: { type: Boolean, default: false },
});

const { t } = useI18n();
const queryClient = useQueryClient();
const progress = ref(0);
const uploading = ref(false);
const errorMessage = ref('');
const statusMessage = ref('');

const mediaQuery = useQuery({
  queryKey: computed(() => mediaKeys.forItem(props.itemPublicId)),
  queryFn: () => listItemMedia(props.itemPublicId),
  enabled: computed(() => Boolean(props.itemPublicId)),
});
const media = computed(() =>
  Array.isArray(mediaQuery.data.value) ? /** @type {MediaItem[]} */ (mediaQuery.data.value) : [],
);
const primary = computed(() => media.value.find((entry) => entry.role === 'primary') ?? null);
const gallery = computed(() => media.value.filter((entry) => entry.role === 'gallery'));

const upload = useMutation({
  /** @param {File} file */
  mutationFn: async (file) => {
    const session = await beginMediaUpload(
      {
        itemPublicId: props.itemPublicId,
        filename: file.name,
        mimeType: file.type,
        byteSize: file.size,
      },
      props.csrfToken,
    );
    const checksum = await fileChecksum(file);
    await uploadMediaContent(
      /** @type {{ sessionId: string }} */ (session).sessionId,
      file,
      props.csrfToken,
      (fraction) => {
        progress.value = Math.round(fraction * 100);
      },
    );
    return finalizeMediaUpload(
      /** @type {{ sessionId: string }} */ (session).sessionId,
      {
        role: media.value.length === 0 ? 'primary' : 'gallery',
        altText: file.name.replace(/\.[^.]+$/u, ''),
        checksumSha256: checksum,
      },
      props.csrfToken,
    );
  },
  onMutate: () => {
    uploading.value = true;
    progress.value = 0;
    errorMessage.value = '';
    statusMessage.value = '';
  },
  onSuccess: async () => {
    statusMessage.value = t('media.uploaded');
    await refresh();
  },
  onError: (error) => {
    errorMessage.value = describe(error);
  },
  onSettled: () => {
    uploading.value = false;
  },
});

const promote = useMutation({
  /** @param {string} relationId */
  mutationFn: (relationId) =>
    setPrimaryItemMedia(relationId, props.expectedVersion, props.csrfToken),
  onSuccess: async () => {
    statusMessage.value = t('media.primarySet');
    await refresh();
  },
  onError: (error) => {
    errorMessage.value = describe(error);
  },
});

const move = useMutation({
  /** @param {readonly string[]} order */
  mutationFn: (order) =>
    reorderItemMedia(props.itemPublicId, props.expectedVersion, order, props.csrfToken),
  onSuccess: async () => {
    statusMessage.value = t('media.reordered');
    await refresh();
  },
  onError: (error) => {
    errorMessage.value = describe(error);
  },
});

const detach = useMutation({
  /** @param {string} relationId */
  mutationFn: (relationId) => detachItemMedia(relationId, props.expectedVersion, props.csrfToken),
  onSuccess: async () => {
    statusMessage.value = t('media.detached');
    await refresh();
  },
  onError: (error) => {
    errorMessage.value = describe(error);
  },
});

function refresh() {
  return queryClient.invalidateQueries({ queryKey: mediaKeys.forItem(props.itemPublicId) });
}

/**
 * Localizes a rejection from its stable code; API prose is never displayed.
 * @param {unknown} error
 */
function describe(error) {
  const detail = error && typeof error === 'object' && 'detail' in error ? error.detail : null;
  const fields = fieldErrorsFromProblem(detail);
  const code = Object.values(fields).find(Boolean);
  const key = typeof code === 'string' ? code.split(' ')[0] : '';
  const known = [
    'MEDIA_TYPE_UNSUPPORTED',
    'MEDIA_TYPE_EXTENSION_MISMATCH',
    'MEDIA_SIZE_EXCEEDED',
    'MEDIA_SIZE_MISMATCH',
    'MEDIA_CHECKSUM_MISMATCH',
    'MEDIA_SIGNATURE_UNRECOGNIZED',
    'MEDIA_SIGNATURE_MISMATCH',
    'MEDIA_SESSION_EXPIRED',
  ];
  if (known.includes(key)) return t(`media.errors.${camel(key)}`);
  return t(problemMessageKey(error));
}

/** @param {string} code */
function camel(code) {
  return code
    .replace('MEDIA_', '')
    .toLowerCase()
    .replace(/_(.)/gu, (_match, letter) => letter.toUpperCase());
}

/**
 * The UI facade forwards the adapter's select payload, which carries the chosen files.
 * @param {{ files?: File[] } | File[]} event
 */
function onFiles(event) {
  const files = Array.isArray(event) ? event : (event?.files ?? []);
  for (const file of files) upload.mutate(file);
}

/** @param {number} index @param {number} delta */
function shift(index, delta) {
  const order = gallery.value.map((entry) => entry.relationId);
  const target = index + delta;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  move.mutate(order);
}
</script>

<template>
  <section class="item-media" :aria-label="t('media.section')">
    <h3>{{ t('media.section') }}</h3>

    <p v-if="mediaQuery.isLoading.value">{{ t('common.loading') }}</p>
    <p v-else-if="mediaQuery.isError.value" role="alert">{{ t('common.loadFailed') }}</p>

    <template v-else>
      <p v-if="!media.length" class="item-media__muted">{{ t('media.empty') }}</p>

      <ul v-else class="item-media__list">
        <li v-for="entry in media" :key="entry.relationId" class="item-media__entry">
          <img
            :src="entry.contentUrl"
            :alt="entry.altText ?? entry.originalFilename"
            class="item-media__thumbnail"
            width="96"
            height="96"
            loading="lazy"
          />
          <div class="item-media__meta">
            <strong>{{ entry.originalFilename }}</strong>
            <span class="item-media__muted">
              {{ t(`media.roles.${entry.role}`) }}
              <template v-if="entry.processingState !== 'ready'">
                · {{ t('media.processing') }}
              </template>
            </span>
          </div>
          <div v-if="canEdit" class="item-media__actions">
            <AppButton
              v-if="entry.role !== 'primary'"
              type="button"
              variant="secondary"
              :disabled="promote.isPending.value"
              @click="promote.mutate(entry.relationId)"
            >
              {{ t('media.makePrimary') }}
            </AppButton>
            <AppButton
              v-if="entry.role === 'gallery'"
              type="button"
              variant="secondary"
              :aria-label="t('media.moveEarlier', { name: entry.originalFilename })"
              :disabled="move.isPending.value"
              @click="shift(gallery.indexOf(entry), -1)"
            >
              ↑
            </AppButton>
            <AppButton
              v-if="entry.role === 'gallery'"
              type="button"
              variant="secondary"
              :aria-label="t('media.moveLater', { name: entry.originalFilename })"
              :disabled="move.isPending.value"
              @click="shift(gallery.indexOf(entry), 1)"
            >
              ↓
            </AppButton>
            <AppButton
              type="button"
              variant="secondary"
              :aria-label="t('media.remove', { name: entry.originalFilename })"
              :disabled="detach.isPending.value"
              @click="detach.mutate(entry.relationId)"
            >
              {{ t('media.removeAction') }}
            </AppButton>
          </div>
        </li>
      </ul>

      <template v-if="canEdit">
        <AppFileUpload
          accept="image/jpeg,image/png,image/webp,image/heic"
          :choose-label="t('media.choose')"
          :multiple="true"
          :auto="false"
          :custom-upload="true"
          :show-upload-button="false"
          :show-cancel-button="false"
          :disabled="uploading"
          @select="onFiles"
        >
          <template #empty>{{ t('media.dropHint') }}</template>
        </AppFileUpload>
        <p v-if="uploading" class="item-media__progress">
          <progress :value="progress" max="100" :aria-label="t('media.uploading')">
            {{ progress }}%
          </progress>
          <span>{{ t('media.uploadingPercent', { percent: progress }) }}</span>
        </p>
      </template>

      <p v-if="primary" class="item-media__muted">
        {{ t('media.primaryIs', { name: primary.originalFilename }) }}
      </p>
      <p v-if="statusMessage" role="status">{{ statusMessage }}</p>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    </template>
  </section>
</template>

<style scoped>
.item-media {
  display: grid;
  gap: var(--ia-space-3);
}
.item-media h3,
.item-media p {
  margin: 0;
}
.item-media__muted {
  color: var(--ia-color-text-muted);
}
.item-media__list {
  display: grid;
  gap: var(--ia-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.item-media__entry {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ia-space-3);
  padding: var(--ia-space-2);
  border: 1px solid var(--ia-color-border);
  border-radius: var(--ia-radius-md);
}
.item-media__thumbnail {
  width: 6rem;
  height: 6rem;
  object-fit: cover;
  border-radius: var(--ia-radius-sm, 4px);
  background: var(--ia-color-surface-100);
}
.item-media__meta {
  display: grid;
  min-width: 0;
  gap: var(--ia-space-1);
  overflow-wrap: anywhere;
}
.item-media__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ia-space-2);
}
.item-media__progress {
  display: flex;
  align-items: center;
  gap: var(--ia-space-2);
}
.item-media__progress progress {
  flex: 1 1 auto;
}
@media (max-width: 720px) {
  .item-media__entry {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .item-media__actions {
    grid-column: 1 / -1;
  }
}
</style>
