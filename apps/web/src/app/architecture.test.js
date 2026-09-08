import { createPinia, setActivePinia } from 'pinia';
import { QueryClient } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiConflict, apiRequest } from '../shared/api/client.js';
import {
  invalidateAfterMutation,
  requireExpectedVersion,
  routeConflict,
} from '../shared/api/mutations.js';
import { fieldErrorsFromProblem } from '../shared/lib/form-errors.js';
import { useSessionStore } from './stores/session.js';

afterEach(() => vi.unstubAllGlobals());

describe('frontend architecture policies', () => {
  it('passes cancellation, credentials, and correlation through the single API wrapper', async () => {
    const controller = new AbortController();
    /** @type {RequestInit | undefined} */
    let captured;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path, init) => {
        captured = init;
        return new Response(null, { status: 204 });
      }),
    );
    await apiRequest('/items', { signal: controller.signal }, { correlationId: 'request-1' });
    if (!captured) throw new Error('Fetch was not called.');
    expect(captured.signal).toBe(controller.signal);
    expect(captured.credentials).toBe('same-origin');
    expect(new Headers(captured.headers).get('X-Request-ID')).toBe('request-1');
  });

  it('invalidates Vue Query state after a successful mutation', async () => {
    const queryClient = new QueryClient();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    await invalidateAfterMutation(queryClient, ['items']);
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['items'] });
  });

  it('clears only the Pinia session summary', () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.summary = {
      id: 'user-1',
      displayName: 'Viewer',
      role: 'viewer',
      permissions: [],
      csrfToken: 'csrf',
    };
    session.clear();
    expect(session.summary).toBeNull();
  });

  it('rejects an optimistic mutation with an unknown version', () => {
    expect(() => requireExpectedVersion(undefined)).toThrow('known non-negative expected version');
    expect(requireExpectedVersion(3)).toBe(3);
  });

  it('routes conflicts to compare, reload, and abandon handling', () => {
    const open = vi.fn();
    const conflict = new ApiConflict(409, {
      currentVersion: 8,
      safeDiff: { name: ['old', 'new'] },
    });
    expect(routeConflict(conflict, { open })).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ actions: ['compare', 'reload', 'abandon'] }),
    );
  });

  it('maps stable field keys into local form errors', () => {
    expect(
      fieldErrorsFromProblem({ errors: [{ fieldKey: 'serial_number', message: 'Required' }] }),
    ).toEqual({ serial_number: 'Required' });
  });
});
