import { describe, expect, it } from 'vitest';
import { can, canManageRole, capabilities, permissionsFor } from './authorization.js';

describe('role capability policy', () => {
  it('matches the section 16.1 fixed capability rows', () => {
    expect(permissionsFor('public')).toEqual([]);
    expect(can('public', 'viewPublicCards', { publicCatalogEnabled: true })).toBe(true);
    expect(permissionsFor('viewer')).toEqual(['viewPublicCards', 'viewAuthenticatedFields']);
    expect(can('editor', 'editItems')).toBe(true);
    expect(can('editor', 'viewPrivateFields')).toBe(false);
    expect(can('admin', 'viewPrivateFields')).toBe(true);
    expect(can('admin', 'manageUsers')).toBe(true);
    expect(can('admin', 'manageUsers', { adminGrants: [] })).toBe(false);
    expect(permissionsFor('owner')).toEqual(capabilities);
  });

  it('never lets Admin manage an Owner role', () => {
    expect(canManageRole('admin', 'editor')).toBe(true);
    expect(canManageRole('admin', 'owner')).toBe(false);
    expect(canManageRole('owner', 'owner')).toBe(true);
  });
});
