import { describe, expect, it } from 'vitest';
import { isLicenseApproved } from './license-policy.mjs';

describe('owner-approved development license exception', () => {
  const elk = { name: 'elkjs', version: '0.11.1', license: 'EPL-2.0' };
  it('allows only the exact reviewed component in development', () => {
    expect(isLicenseApproved(elk)).toBe(true);
    expect(isLicenseApproved({ ...elk, version: '0.12.0' })).toBe(false);
    expect(isLicenseApproved({ ...elk, name: 'another-library' })).toBe(false);
    expect(isLicenseApproved({ ...elk, license: 'GPL-3.0-only' })).toBe(false);
  });
  it('rejects the exception in runtime and rejects missing licenses', () => {
    expect(isLicenseApproved(elk, true)).toBe(false);
    expect(isLicenseApproved({ name: 'unknown', version: '1.0.0' })).toBe(false);
    expect(isLicenseApproved({ ...elk, license: 'MIT' }, true)).toBe(true);
  });
  it('requires every license in a conjunction to be approved', () => {
    expect(isLicenseApproved({ ...elk, license: 'MIT and ISC' })).toBe(true);
    expect(isLicenseApproved({ ...elk, license: 'MIT AND EPL-2.0' })).toBe(false);
    expect(isLicenseApproved({ ...elk, license: 'Unlicense' })).toBe(true);
  });
});
