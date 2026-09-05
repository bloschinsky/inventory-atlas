import { ApiConflict } from './client.js';

/** @param {number | undefined | null} expectedVersion */
export function requireExpectedVersion(expectedVersion) {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw new TypeError('A known non-negative expected version is required.');
  }
  return expectedVersion;
}

/**
 * @param {{ expectedVersion?: number }} input
 * @param {(input: { expectedVersion?: number }) => Promise<unknown>} mutation
 */
export function runVersionedMutation(input, mutation) {
  requireExpectedVersion(input.expectedVersion);
  return mutation(input);
}

/**
 * @param {unknown} error
 * @param {{ open: (model: { currentVersion: unknown, safeDiff: unknown, actions: string[] }) => void }} conflictUi
 */
export function routeConflict(error, conflictUi) {
  if (!(error instanceof ApiConflict)) return false;
  conflictUi.open({
    currentVersion: error.currentVersion,
    safeDiff: error.safeDiff,
    actions: ['compare', 'reload', 'abandon'],
  });
  return true;
}

/**
 * @param {import('@tanstack/vue-query').QueryClient} queryClient
 * @param {readonly unknown[]} queryKey
 */
export function invalidateAfterMutation(queryClient, queryKey) {
  return queryClient.invalidateQueries({ queryKey });
}
