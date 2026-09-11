import { apiRequest } from '../../shared/api/client.js';

export const mediaKeys = {
  all: /** @type {const} */ (['media']),
  /** @param {string} publicId */
  forItem: (publicId) => /** @type {const} */ (['media', 'item', publicId]),
};

/**
 * Declares one upload and receives the session the bytes are streamed to.
 * @param {{ itemPublicId: string, filename: string, mimeType: string, byteSize: number }} input
 * @param {string} csrfToken
 */
export function beginMediaUpload(input, csrfToken) {
  return apiRequest(
    '/media/upload-sessions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/**
 * Streams the raw file to its session. `XMLHttpRequest` is used instead of `fetch` because it is
 * the only transport that reports upload progress, which the accessible progress bar needs.
 * @param {string} sessionId
 * @param {Blob} file
 * @param {string} csrfToken
 * @param {(fraction: number) => void} [onProgress]
 */
export function uploadMediaContent(sessionId, file, csrfToken, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `/api/v1/media/upload-sessions/${sessionId}/content`);
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('X-CSRF-Token', csrfToken);
    request.setRequestHeader('X-Request-ID', crypto.randomUUID());
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    request.addEventListener('error', () => reject(new Error('The upload could not be sent.')));
    request.addEventListener('load', () => {
      const detail = parseJson(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve(detail);
        return;
      }
      reject(
        Object.assign(new Error(`API request failed with status ${request.status}`), {
          name: 'ApiProblem',
          status: request.status,
          detail,
        }),
      );
    });
    request.send(file);
  });
}

/**
 * @param {string} sessionId
 * @param {{ role?: string, altText?: string|null, checksumSha256?: string|null }} input
 * @param {string} csrfToken
 */
export function finalizeMediaUpload(sessionId, input, csrfToken) {
  return apiRequest(
    `/media/upload-sessions/${sessionId}/finalize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}

/** @param {string} itemPublicId */
export function listItemMedia(itemPublicId) {
  return apiRequest(`/items/${itemPublicId}/media`);
}

/**
 * @param {string} itemPublicId
 * @param {number} expectedVersion
 * @param {readonly string[]} order
 * @param {string} csrfToken
 */
export function reorderItemMedia(itemPublicId, expectedVersion, order, csrfToken) {
  return apiRequest(
    '/media/relations/reorder',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemPublicId, expectedVersion, order }),
    },
    { csrfToken },
  );
}

/** @param {string} relationId @param {number} expectedVersion @param {string} csrfToken */
export function setPrimaryItemMedia(relationId, expectedVersion, csrfToken) {
  return apiRequest(
    `/media/relations/${relationId}/primary`,
    { method: 'POST', headers: { 'If-Match': `"${expectedVersion}"` } },
    { csrfToken },
  );
}

/** @param {string} relationId @param {number} expectedVersion @param {string} csrfToken */
export function detachItemMedia(relationId, expectedVersion, csrfToken) {
  return apiRequest(
    `/media/relations/${relationId}`,
    { method: 'DELETE', headers: { 'If-Match': `"${expectedVersion}"` } },
    { csrfToken },
  );
}

/**
 * Computes the SHA-256 the server verifies, so a corrupted transfer is caught at finalize.
 * @param {Blob} file
 */
export async function fileChecksum(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {string} text */
function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
