import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookie,
  readSessionCookie,
  sessionCookie,
  sessionCookieName,
} from './auth.http.js';

describe('session cookie transport', () => {
  const token = 'A'.repeat(43);

  it('reads exactly one valid opaque session cookie', () => {
    expect(readSessionCookie(`theme=dark; ${sessionCookieName}=${token}; locale=en`)).toBe(token);
    expect(readSessionCookie(`${sessionCookieName}=${token}; ${sessionCookieName}=${token}`)).toBe(
      undefined,
    );
    expect(readSessionCookie(`${sessionCookieName}=raw token`)).toBe(undefined);
  });

  it('serializes secure and local cookies with fixed security attributes', () => {
    expect(sessionCookie(token, true, 120)).toBe(
      `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=120; Secure`,
    );
    expect(sessionCookie(token, false, 120)).not.toContain('Secure');
    expect(clearedSessionCookie(true)).toContain(
      'Max-Age=0; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
  });
});
