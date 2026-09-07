export const sessionCookieName = 'inventory_atlas_session';

const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const matches = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookieName}=`))
    .map((part) => part.slice(sessionCookieName.length + 1));
  if (matches.length !== 1 || !opaqueTokenPattern.test(matches[0] ?? '')) return undefined;
  return matches[0];
}

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const attributes = [
    `${sessionCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return `${sessionCookie('', secure, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
