/** @param {unknown} problem */
export function fieldErrorsFromProblem(problem) {
  if (!problem || typeof problem !== 'object') return {};
  const entries =
    'fieldErrors' in problem && Array.isArray(problem.fieldErrors)
      ? problem.fieldErrors
      : 'errors' in problem && Array.isArray(problem.errors)
        ? problem.errors
        : [];
  return Object.fromEntries(
    entries
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (typeof entry.fieldKey === 'string' || typeof entry.field === 'string'),
      )
      .map((entry) => [
        'fieldKey' in entry ? String(entry.fieldKey) : String(entry.field),
        'message' in entry && typeof entry.message === 'string'
          ? entry.message
          : 'messages' in entry && Array.isArray(entry.messages)
            ? entry.messages.join(' ')
            : '',
      ]),
  );
}
