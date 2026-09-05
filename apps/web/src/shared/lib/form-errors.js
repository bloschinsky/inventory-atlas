/** @param {unknown} problem */
export function fieldErrorsFromProblem(problem) {
  if (
    !problem ||
    typeof problem !== 'object' ||
    !('errors' in problem) ||
    !Array.isArray(problem.errors)
  )
    return {};
  return Object.fromEntries(
    problem.errors
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.fieldKey === 'string' &&
          typeof entry.message === 'string',
      )
      .map((entry) => [entry.fieldKey, entry.message]),
  );
}
