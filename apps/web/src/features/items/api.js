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
