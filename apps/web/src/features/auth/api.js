import { apiRequest } from '../../shared/api/client.js';

export const authKeys = {
  current: ['auth', 'current'],
  sessions: ['auth', 'sessions'],
  users: ['auth', 'users'],
  invitations: ['auth', 'invitations'],
};

export function getCurrentSession() {
  return apiRequest('/auth/me');
}
/** @param {string} locale @param {string} csrfToken @returns {Promise<{ locale: string }>} */
export function updateCurrentLocale(locale, csrfToken) {
  return /** @type {Promise<{ locale: string }>} */ (
    apiRequest(
      '/auth/me/locale',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      },
      { csrfToken },
    )
  );
}
/** @param {{ email: string, password: string }} input */
export function signIn(input) {
  return apiRequest('/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
/** @param {string} csrfToken */
export function signOut(csrfToken) {
  return apiRequest('/auth/session', { method: 'DELETE' }, { csrfToken });
}
export function listSessions() {
  return apiRequest('/auth/sessions');
}
/** @param {string} id @param {string} csrfToken */
export function revokeSession(id, csrfToken) {
  return apiRequest(`/auth/sessions/${id}`, { method: 'DELETE' }, { csrfToken });
}
export function listUsers() {
  return apiRequest('/admin/users');
}
export function listInvitations() {
  return apiRequest('/admin/invitations');
}
/** @param {{ email: string, role: string }} input @param {string} csrfToken */
export function issueInvitation(input, csrfToken) {
  return apiRequest(
    '/admin/invitations',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}
/** @param {string} id @param {number} version @param {string} csrfToken */
export function revokeInvitation(id, version, csrfToken) {
  return apiRequest(
    `/admin/invitations/${id}`,
    { method: 'DELETE', headers: { 'If-Match': String(version) } },
    { csrfToken },
  );
}
/** @param {{ token: string, displayName: string, password: string, locale: string }} input */
export function acceptInvitation(input) {
  return apiRequest('/auth/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
/** @param {string} id @param {{ expectedVersion: number, role: string, ownerConfirmation?: boolean }} input @param {string} csrfToken */
export function updateUser(id, input, csrfToken) {
  return apiRequest(
    `/admin/users/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { csrfToken },
  );
}
