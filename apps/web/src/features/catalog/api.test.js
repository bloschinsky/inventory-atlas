import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveDictionaryEntry, createDictionaryEntry, listDictionary } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('catalog dictionary API client', () => {
  it('loads archived Admin entries and sends CSRF on create', async () => {
    /** @type {{ path: string, init: RequestInit | undefined }[]} */
    const requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path, init) => {
        requests.push({ path: String(path), init });
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );

    await listDictionary('categories');
    await createDictionaryEntry(
      'categories',
      { key: 'tools', labels: { en: 'Tools', uk: 'Інструменти' }, displayOrder: 1 },
      'c'.repeat(43),
    );

    expect(requests[0].path).toBe('/api/v1/categories?includeArchived=true');
    expect(requests[1].path).toBe('/api/v1/categories');
    expect(requests[1].init?.method).toBe('POST');
    expect(new Headers(requests[1].init?.headers).get('X-CSRF-Token')).toBe('c'.repeat(43));
  });

  it('uses If-Match when archiving a status', async () => {
    /** @type {RequestInit | undefined} */
    let captured;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path, init) => {
        captured = init;
        return new Response(null, { status: 204 });
      }),
    );
    await archiveDictionaryEntry('lifecycle-statuses', 'status-id', 7, 'c'.repeat(43));
    if (!captured) throw new Error('Fetch was not called.');
    expect(captured.method).toBe('DELETE');
    expect(new Headers(captured.headers).get('If-Match')).toBe('7');
  });
});
