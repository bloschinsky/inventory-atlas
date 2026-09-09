import { describe, expect, it, vi } from 'vitest';
import { permissionsFor, type SessionActor } from '../auth/index.js';
import { CatalogDictionaryService } from './dictionary-service.js';

const admin: SessionActor = {
  id: 'admin-id',
  email: 'admin@example.test',
  displayName: 'Admin',
  locale: 'en',
  role: 'admin',
  permissions: permissionsFor('admin'),
};

function repository() {
  return {
    listCategories: vi.fn(async () => []),
    findCategoryById: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    archiveCategory: vi.fn(),
    listLifecycleStatuses: vi.fn(async () => []),
    findLifecycleStatusById: vi.fn(),
    createLifecycleStatus: vi.fn(),
    updateLifecycleStatus: vi.fn(),
    archiveLifecycleStatus: vi.fn(),
  };
}

describe('catalog dictionary application service', () => {
  it('allows an Admin to manage dictionaries', async () => {
    const adapter = repository();
    const service = new CatalogDictionaryService(adapter as never);
    await service.listCategories(admin, true);
    expect(adapter.listCategories).toHaveBeenCalledWith(true);
  });

  it('allows active reads but rejects management without manageSchema', async () => {
    const adapter = repository();
    const service = new CatalogDictionaryService(adapter as never);
    const editor = { ...admin, role: 'editor' as const, permissions: permissionsFor('editor') };
    await service.listLifecycleStatuses(editor);
    expect(adapter.listLifecycleStatuses).toHaveBeenCalledWith(false);
    expect(() => service.listLifecycleStatuses(editor, true)).toThrow(
      expect.objectContaining({ code: 'CATALOG_DICTIONARY_FORBIDDEN' }),
    );
    expect(() =>
      service.createCategory(editor, {
        key: 'tools',
        labels: { en: 'Tools' },
        displayOrder: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'CATALOG_DICTIONARY_FORBIDDEN' }));
    expect(adapter.createCategory).not.toHaveBeenCalled();
  });

  it('allows historical Item resolution to include archived dictionaries for a viewer', async () => {
    const adapter = repository();
    const service = new CatalogDictionaryService(adapter as never);
    const viewer = { ...admin, role: 'viewer' as const, permissions: permissionsFor('viewer') };
    await service.resolveCategory(viewer, 'category-id');
    await service.resolveLifecycleStatus(viewer, 'status-id');
    expect(adapter.findCategoryById).toHaveBeenCalledWith('category-id', true);
    expect(adapter.findLifecycleStatusById).toHaveBeenCalledWith('status-id', true);
  });
});
