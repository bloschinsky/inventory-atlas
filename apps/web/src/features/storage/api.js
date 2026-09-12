import { apiRequest } from '../../shared/api/client.js';

export const storageKeys = {
  all: /** @type {const} */ (['storage']),
  /** @param {string|null} parentPublicId */
  children: (parentPublicId) => /** @type {const} */ (['storage', 'children', parentPublicId]),
  /** @param {string} publicId */
  detail: (publicId) => /** @type {const} */ (['storage', publicId]),
  destinations: /** @type {const} */ (['storage', 'destinations']),
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

/** @param {string} publicId @param {number} expectedVersion @param {{targetParentPublicId:string, reason?:string}} input @param {string} csrfToken */
export function moveStorageNode(publicId, expectedVersion, input, csrfToken) {
  return apiRequest(
    `/storage-nodes/${publicId}/move`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': `"${expectedVersion}"` },
      body: JSON.stringify({ ...input, expectedVersion }),
    },
    { csrfToken },
  );
}

export async function listStorageDestinations() {
  const destinations =
    /** @type {Array<Record<string, any> & {publicId:string, parentPublicId:string|null, title:string, pathLabel:string, ancestorPublicIds:string[]}>} */ ([]);
  const pending =
    /** @type {Array<{parentPublicId:string|null, ancestorTitles:string[], ancestorPublicIds:string[]}>} */ ([
      { parentPublicId: null, ancestorTitles: [], ancestorPublicIds: [] },
    ]);
  while (pending.length) {
    const branch = pending.shift();
    if (!branch) break;
    let cursor = null;
    do {
      const page = await listStorageNodes({
        parentPublicId: branch.parentPublicId,
        limit: 100,
        cursor,
      });
      for (const node of page.entries) {
        const titles = [...branch.ancestorTitles, node.title];
        destinations.push({
          ...node,
          pathLabel: titles.join(' / '),
          ancestorPublicIds: branch.ancestorPublicIds,
        });
        pending.push({
          parentPublicId: node.publicId,
          ancestorTitles: titles,
          ancestorPublicIds: [...branch.ancestorPublicIds, node.publicId],
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return destinations;
}
