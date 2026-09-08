import { ApiProblem } from '../api/client.js';

const statusKeys = new Map([
  [400, 'problems.badRequest'],
  [401, 'problems.unauthorized'],
  [403, 'problems.forbidden'],
  [404, 'problems.notFound'],
  [409, 'problems.conflict'],
  [412, 'problems.conflict'],
  [429, 'problems.rateLimited'],
]);

/**
 * Converts transport failures to local keys so API prose is never the UI's
 * localization source.
 * @param {unknown} error
 */
export function problemMessageKey(error) {
  if (!(error instanceof ApiProblem)) return 'problems.serverError';
  return statusKeys.get(error.status) ?? 'problems.serverError';
}
