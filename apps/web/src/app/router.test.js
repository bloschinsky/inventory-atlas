import { describe, expect, it } from 'vitest';
import { routeRecords } from './router.js';
describe('route baseline', () => {
  it('contains every approved route', () => {
    expect(routeRecords).toHaveLength(17);
    expect(routeRecords.map(({ path }) => path)).toContain('/admin/audit');
    const dictionaries = routeRecords.filter(({ path }) =>
      ['/admin/categories', '/admin/statuses'].includes(path),
    );
    expect(dictionaries.every(({ component }) => component.__name === 'DictionaryPage')).toBe(true);
  });
});
