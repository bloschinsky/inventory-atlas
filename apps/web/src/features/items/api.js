import { apiRequest } from '../../shared/api/client.js';

export const itemKeys = {
  all: /** @type {const} */ (['items']),
  /** @param {string} publicId */
  detail: (publicId) => /** @type {const} */ (['items', publicId]),
  /** @param {string} publicId */
  movements: (publicId) => /** @type {const} */ (['items', publicId, 'movements']),
};

/** @param {Record<string, unknown>} input @param {string} csrfToken @param {string} idempotencyKey */
export function createItem(input, csrfToken, idempotencyKey) {
  return apiRequest(
    '/items',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} publicId @param {{limit?:number, cursor?:string|null}} [query] */
export function listItemMovements(publicId, query = {}) {
  const parameters = new URLSearchParams();
  if (query.limit) parameters.set('limit', String(query.limit));
  if (query.cursor) parameters.set('cursor', query.cursor);
  const suffix = parameters.size ? `?${parameters}` : '';
  return apiRequest(`/items/${publicId}/movements${suffix}`);
}

/**
 * @param {string} publicId
 * @param {number} expectedVersion
 * @param {{storageNodeId:string|null, reason?:string}} input
 * @param {string} csrfToken
 * @param {string} idempotencyKey
 */
export function moveItem(publicId, expectedVersion, input, csrfToken, idempotencyKey) {
  return apiRequest(
    `/items/${publicId}/move`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedVersion}"`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ ...input, expectedVersion }),
    },
    { csrfToken },
  );
}

/** @param {string} publicId */
export function getItem(publicId) {
  return apiRequest(`/items/${publicId}`);
}

/**
 * Versioned Item update. The known version travels as `If-Match` and in the body, so the server
 * rejects a stale edit with a conflict instead of overwriting a concurrent one.
 * @param {string} publicId
 * @param {number} expectedVersion
 * @param {Record<string, unknown>} input
 * @param {string} csrfToken
 * @param {string} [idempotencyKey]
 */
export function updateItem(publicId, expectedVersion, input, csrfToken, idempotencyKey) {
  return apiRequest(
    `/items/${publicId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${expectedVersion}"`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ ...input, expectedVersion }),
    },
    { csrfToken },
  );
}
