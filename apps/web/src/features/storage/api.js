import { apiRequest } from '../../shared/api/client.js';

export const storageKeys = {
  all: /** @type {const} */ (['storage']),
  /** @param {string|null} parentPublicId */
  children: (parentPublicId) => /** @type {const} */ (['storage', 'children', parentPublicId]),
  /** @param {string} publicId */
  detail: (publicId) => /** @type {const} */ (['storage', publicId]),
};

/** @param {{ parentPublicId?: string|null, limit?: number, cursor?: string|null }} [query] */
export function listStorageNodes(query = {}) {
  const parameters = new URLSearchParams();
  if (query.parentPublicId) parameters.set('parentPublicId', query.parentPublicId);
  if (query.limit) parameters.set('limit', String(query.limit));
  if (query.cursor) parameters.set('cursor', query.cursor);
  const suffix = parameters.size ? `?${parameters}` : '';
  return apiRequest(`/storage-nodes${suffix}`);
}

/** @param {Record<string, unknown>} input @param {string} csrfToken */
export function createStorageNode(input, csrfToken) {
  return apiRequest(
    '/storage-nodes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} publicId @param {{limit?: number, cursor?: string|null}} [query] */
export function getStorageNode(publicId, query = {}) {
  const parameters = new URLSearchParams();
  if (query.limit) parameters.set('limit', String(query.limit));
  if (query.cursor) parameters.set('cursor', query.cursor);
  const suffix = parameters.size ? `?${parameters}` : '';
  return apiRequest(`/storage-nodes/${publicId}${suffix}`);
}

/** @param {string} publicId @param {number} expectedVersion @param {Record<string, unknown>} input @param {string} csrfToken */
export function updateStorageNode(publicId, expectedVersion, input, csrfToken) {
  return apiRequest(
    `/storage-nodes/${publicId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': `"${expectedVersion}"` },
      body: JSON.stringify({ ...input, expectedVersion }),
    },
    { csrfToken },
  );
}
