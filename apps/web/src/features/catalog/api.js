import { apiRequest } from '../../shared/api/client.js';

export const catalogKeys = {
  categories: ['catalog', 'categories'],
  statuses: ['catalog', 'lifecycle-statuses'],
};

/** @param {'categories'|'lifecycle-statuses'} kind */
export function listDictionary(kind) {
  return apiRequest(`/${kind}?includeArchived=true`);
}

/** @param {'categories'|'lifecycle-statuses'} kind @param {Record<string, unknown>} input @param {string} csrfToken */
export function createDictionaryEntry(kind, input, csrfToken) {
  return apiRequest(
    `/${kind}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {'categories'|'lifecycle-statuses'} kind @param {string} id @param {Record<string, unknown>} input @param {string} csrfToken */
export function updateDictionaryEntry(kind, id, input, csrfToken) {
  return apiRequest(
    `/${kind}/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {'categories'|'lifecycle-statuses'} kind @param {string} id @param {number} version @param {string} csrfToken */
export function archiveDictionaryEntry(kind, id, version, csrfToken) {
  return apiRequest(
    `/${kind}/${id}`,
    { method: 'DELETE', headers: { 'If-Match': String(version) } },
    { csrfToken },
  );
}
