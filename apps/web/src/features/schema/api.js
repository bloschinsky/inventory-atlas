import { apiRequest } from '../../shared/api/client.js';

export const schemaKeys = {
  fields: /** @type {const} */ (['schema', 'field-definitions']),
  /** @param {string} scope */
  fieldsForScope: (scope) => /** @type {const} */ (['schema', 'field-definitions', scope]),
};

/** @param {'item'|'storage_node'} scope */
export function listFieldDefinitions(scope) {
  return apiRequest(`/field-definitions?scope=${scope}&includeArchived=true`);
}

/** @param {Record<string, unknown>} input @param {string} csrfToken */
export function createFieldDefinition(input, csrfToken) {
  return apiRequest(
    '/field-definitions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} id @param {Record<string, unknown>} input @param {string} csrfToken */
export function updateFieldDefinition(id, input, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} id @param {number} version @param {string} csrfToken */
export function archiveFieldDefinition(id, version, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}`,
    { method: 'DELETE', headers: { 'If-Match': String(version) } },
    { csrfToken },
  );
}

/** @param {string} id @param {string} targetDataType @param {string} csrfToken */
export function previewFieldConversion(id, targetDataType, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}/conversion-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDataType }),
    },
    { csrfToken },
  );
}

/** @param {string} id @param {Record<string, unknown>} input @param {string} csrfToken */
export function createFieldOption(id, input, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}/options`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/**
 * @param {string} id @param {string} optionId
 * @param {Record<string, unknown>} input @param {string} csrfToken
 */
export function updateFieldOption(id, optionId, input, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}/options/${optionId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} id @param {string} optionId @param {number} version @param {string} csrfToken */
export function archiveFieldOption(id, optionId, version, csrfToken) {
  return apiRequest(
    `/field-definitions/${id}/options/${optionId}`,
    { method: 'DELETE', headers: { 'If-Match': String(version) } },
    { csrfToken },
  );
}
