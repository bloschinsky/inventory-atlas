import { AuthRateLimiter, SessionError, permissionsFor } from '@inventory-atlas/backend';
import { describe, expect, it, vi } from 'vitest';
import type { AuthRuntimePort } from './auth.runtime.js';
import type { FoundationRuntimePort } from './foundation.runtime.js';
import { createApiApplication } from './main.js';
import { createOpenApiDocument } from './openapi-document.js';

const issuedAt = new Date('2026-09-07T10:00:00.000Z');
const sessionId = '0198f40c-92f3-7a12-bc9a-653f97786c2b';
const sessionToken = 's'.repeat(43);
const csrfToken = 'c'.repeat(43);
const actor = {
  id: '0198f40c-92f3-7a12-bc9a-653f97786c2c',
  email: 'owner@example.test',
  displayName: 'Synthetic Owner',
  locale: 'en' as const,
  role: 'owner' as const,
  permissions: permissionsFor('owner'),
};

function createAdministrationRuntime() {
  return {
    listUsers: vi.fn(async () => []),
    listInvitations: vi.fn(async () => []),
    issueInvitation: vi.fn(),
    revokeInvitation: vi.fn(async () => undefined),
    acceptInvitation: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(async () => undefined),
  };
}

function createAuthRuntime() {
  return {
    signIn: vi.fn(async () => ({
      id: sessionId,
      token: sessionToken,
      csrfToken,
      idleExpiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1_000),
      absoluteExpiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
      actor,
    })),
    authenticate: vi.fn(async () => ({
      id: sessionId,
      csrfToken,
      idleExpiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1_000),
      absoluteExpiresAt: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
      actor,
    })),
    revokeCurrent: vi.fn(async () => undefined),
    revokeOwned: vi.fn(async () => undefined),
    listOwned: vi.fn(async () => []),
    updateLocale: vi.fn(async (_token, _csrf, locale) => ({ ...actor, locale })),
  };
}

const authSessions = createAuthRuntime();
const administration = createAdministrationRuntime();
const rateLimiter = new AuthRateLimiter('test-secret');
const runtime: FoundationRuntimePort & AuthRuntimePort = {
  async readiness() {
    return {
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    };
  },
  metadata() {
    return {
      apiVersion: 'v1',
      buildVersion: 'test',
      buildRevision: 'test-revision',
      schemaVersion: '0001_foundation',
      supportedLocales: ['en', 'uk'],
    };
  },
  trustProxy() {
    return false;
  },
  authSessions() {
    return authSessions;
  },
  authAdministration() {
    return administration;
  },
  authRateLimiter() {
    return rateLimiter;
  },
  secureSessionCookies() {
    return true;
  },
};

describe('API composition root', () => {
  it('builds a stable OpenAPI document with representative shared contracts', async () => {
    const app = await createApiApplication(runtime);
    const document = createOpenApiDocument(app);
    const operationIds = Object.values(document.paths).flatMap((pathItem) =>
      Object.values(pathItem ?? {})
        .filter(
          (operation) => operation && typeof operation === 'object' && 'operationId' in operation,
        )
        .map((operation) => operation.operationId),
    );

    expect(operationIds.toSorted()).toEqual([
      'acceptInvitation',
      'archiveUser',
      'createAuthSession',
      'deleteAuthSession',
      'getCurrentActor',
      'getFoundationStatus',
      'getLiveness',
      'getMetadata',
      'getReadiness',
      'issueInvitation',
      'listAuthSessions',
      'listInvitations',
      'listUsers',
      'revokeAuthSession',
      'revokeInvitation',
      'updateCurrentActorLocale',
      'updateUser',
    ]);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(document.components?.schemas).toMatchObject({
      CursorPageDto: expect.any(Object),
      ItemMutationRequestDto: expect.any(Object),
      ItemPageResponseDto: expect.any(Object),
      ProblemDetailsDto: expect.any(Object),
      VersionConflictProblemDto: expect.any(Object),
    });
    await app.close();
  });

  it('sets a hardened opaque cookie and returns the separate CSRF token on sign-in', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
    });
    await app.init();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/session',
      payload: { email: 'owner@example.test', password: 'synthetic password' },
      headers: { 'user-agent': 'Synthetic Browser' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain(
      `inventory_atlas_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax;`,
    );
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ sessionId, csrfToken, actor });
    expect(response.body).not.toContain(sessionToken);
    expect(sessions.signIn).toHaveBeenCalledWith(
      'owner@example.test',
      'synthetic password',
      expect.objectContaining({ userAgent: 'Synthetic Browser' }),
    );
    await app.close();
  });

  it('authenticates from the cookie and requires CSRF for every session mutation', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
      secureSessionCookies: () => false,
    });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(sessions.authenticate).toHaveBeenCalledWith(sessionToken);

    const missingCsrf = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(missingCsrf.statusCode).toBe(401);
    expect(sessions.revokeCurrent).not.toHaveBeenCalled();

    const signOut = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie, 'x-csrf-token': csrfToken },
    });
    expect(signOut.statusCode).toBe(204);
    expect(sessions.revokeCurrent).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(signOut.headers['set-cookie']).toContain('Max-Age=0');
    expect(signOut.headers['set-cookie']).not.toContain('Secure');
    await app.close();
  });

  it('persists the current actor locale through a CSRF-protected endpoint', async () => {
    const sessions = createAuthRuntime();
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const rejected = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/locale',
      headers: { cookie },
      payload: { locale: 'uk' },
    });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/locale',
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-request-id': 'locale-request' },
      payload: { locale: 'uk' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: actor.id, locale: 'uk' });
    expect(sessions.updateLocale).toHaveBeenCalledWith(
      sessionToken,
      csrfToken,
      'uk',
      expect.objectContaining({ requestId: 'locale-request' }),
    );
    await app.close();
  });

  it('does not reveal whether an unowned session exists', async () => {
    const sessions = createAuthRuntime();
    sessions.revokeOwned.mockRejectedValueOnce(
      new SessionError('AUTH_SESSION_NOT_FOUND', 'Session was not found.'),
    );
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${sessionId}`,
      headers: {
        cookie: `inventory_atlas_session=${sessionToken}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('owner');
    await app.close();
  });

  it('requires CSRF and passes the authenticated actor to invitation issuance', async () => {
    const sessions = createAuthRuntime();
    const authAdministration = createAdministrationRuntime();
    authAdministration.issueInvitation.mockResolvedValueOnce({
      id: '0198f40c-92f3-7a12-bc9a-653f97786c2d',
      email: 'viewer@example.test',
      role: 'viewer',
      expiresAt: new Date('2026-09-15T10:00:00.000Z'),
      acceptedAt: null,
      revokedAt: null,
      version: 1,
      token: 'i'.repeat(43),
    });
    const app = await createApiApplication({
      ...runtime,
      authSessions: () => sessions,
      authAdministration: () => authAdministration,
    });
    await app.init();
    const cookie = `inventory_atlas_session=${sessionToken}`;

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie },
      payload: { email: 'viewer@example.test', role: 'viewer' },
    });
    expect(rejected.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invitations',
      headers: { cookie, 'x-csrf-token': csrfToken, 'x-request-id': 'request-1' },
      payload: { email: 'viewer@example.test', role: 'viewer' },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ role: 'viewer', token: 'i'.repeat(43) });
    expect(sessions.authenticate).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(authAdministration.issueInvitation).toHaveBeenCalledWith(
      actor,
      { email: 'viewer@example.test', role: 'viewer' },
      expect.objectContaining({ requestId: 'request-1' }),
    );
    await app.close();
  });

  it('clears an invalid session cookie during current-actor recovery', async () => {
    const sessions = createAuthRuntime();
    sessions.authenticate.mockRejectedValueOnce(
      new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.'),
    );
    const app = await createApiApplication({ ...runtime, authSessions: () => sessions });
    await app.init();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `inventory_atlas_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    await app.close();
  });

  it('initializes and closes the Fastify application', async () => {
    const app = await createApiApplication(runtime);
    await app.init();
    expect(app.getHttpAdapter().getType()).toBe('fastify');
    await app.close();
  });

  it('reports process health for container startup ordering', async () => {
    const app = await createApiApplication(runtime);
    await app.init();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      components: {
        database: 'ready',
        schema: 'ready',
        mediaStorage: 'ready',
        mediaCapabilities: 'ready',
      },
    });

    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toEqual(runtime.metadata());

    await app.close();
  });

  it('returns actionable component states when readiness fails', async () => {
    const unreadyRuntime: FoundationRuntimePort & AuthRuntimePort = {
      ...runtime,
      async readiness() {
        return {
          status: 'unready',
          components: {
            database: 'unavailable',
            schema: 'unavailable',
            mediaStorage: 'ready',
            mediaCapabilities: 'ready',
          },
        };
      },
    };
    const app = await createApiApplication(unreadyRuntime);
    await app.init();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('database');
    expect(response.body).toContain('unavailable');

    await app.close();
  });
});
