import { describe, expect, it } from 'vitest';
import { routeRecords } from './router.js';
describe('route baseline', () => {
  it('contains every approved route', () => {
    expect(routeRecords).toHaveLength(17);
    expect(routeRecords.map(({ path }) => path)).toContain('/admin/audit');
  });
});
