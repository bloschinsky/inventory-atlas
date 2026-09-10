import { apiRequest } from '../../shared/api/client.js';

export const itemKeys = {
  all: /** @type {const} */ (['items']),
  /** @param {string} publicId */
  detail: (publicId) => /** @type {const} */ (['items', publicId]),
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
