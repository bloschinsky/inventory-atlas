import { inject } from 'vue';

export const sessionContextKey = Symbol('inventory-atlas-session');

export function useSessionContext() {
  const session = inject(sessionContextKey);
  if (!session) throw new Error('Session context is unavailable.');
  return /** @type {{ summary: { id: string, displayName: string, role: string, permissions: string[], csrfToken: string } | null, set(value: unknown): void, clear(): void }} */ (
    session
  );
}
