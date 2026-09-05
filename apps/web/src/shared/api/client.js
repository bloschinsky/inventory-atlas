export class ApiProblem extends Error {
  /** @param {number} status @param {unknown} detail */
  constructor(status, detail) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiProblem';
    this.status = status;
    this.detail = detail;
  }
}

export class ApiConflict extends ApiProblem {
  /** @param {number} status @param {unknown} detail */
  constructor(status, detail) {
    super(status, detail);
    this.name = 'ApiConflict';
    this.currentVersion =
      detail && typeof detail === 'object' && 'currentVersion' in detail
        ? detail.currentVersion
        : null;
    this.safeDiff =
      detail && typeof detail === 'object' && 'safeDiff' in detail ? detail.safeDiff : null;
  }
}

/**
 * The only transport wrapper used by generated operations.
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {{ correlationId?: string, csrfToken?: string }} [context]
 */
export async function apiRequest(path, init = {}, context = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Request-ID', context.correlationId ?? crypto.randomUUID());
  if (context.csrfToken) headers.set('X-CSRF-Token', context.csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    if (response.status === 409 || response.status === 412)
      throw new ApiConflict(response.status, detail);
    throw new ApiProblem(response.status, detail);
  }
  return response.status === 204 ? null : response.json();
}

/** @param {(request: unknown, init?: RequestInit) => Promise<unknown>} generatedOperation */
export function wrapGeneratedOperation(generatedOperation) {
  return function wrappedOperation(
    /** @type {unknown} */ request,
    /** @type {RequestInit | undefined} */ init,
  ) {
    return generatedOperation(request, init);
  };
}
