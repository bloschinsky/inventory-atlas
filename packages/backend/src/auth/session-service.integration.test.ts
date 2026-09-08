import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionError, SessionService, sessionPolicy } from './session-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `sessions_${randomUUID().replaceAll('-', '')}`;
let adminPool: Pool;
let schemaUrl: string;
let prisma: ReturnType<typeof createSettingsClient>;
let ownerId: string;
let now: Date;

suite('opaque session lifecycle', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    prisma = createSettingsClient(schemaUrl, 4);
    ownerId = randomUUID();
    await prisma.user.create({
      data: {
        id: ownerId,
        emailNormalized: 'owner@example.test',
        displayName: 'Synthetic Owner',
        passwordHash: await new PasswordHasher().hash('correct synthetic password'),
        role: 'owner',
      },
    });
    await prisma.user.create({
      data: {
        id: randomUUID(),
        emailNormalized: 'admin@example.test',
        displayName: 'Synthetic Admin',
        passwordHash: await new PasswordHasher().hash('correct synthetic password'),
        role: 'admin',
      },
    });
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    now = new Date('2026-09-07T10:00:00.000Z');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  function service(realPasswordVerification = false) {
    return new SessionService(prisma, 'synthetic-session-secret-for-tests', {
      now: () => new Date(now),
      ...(realPasswordVerification
        ? {}
        : {
            passwordHasher: {
              verify: async (_encodedHash: string, password: string) =>
                password === 'correct synthetic password',
            },
          }),
    });
  }

  it('issues independent opaque credentials and stores only hashes', async () => {
    const first = await service(true).signIn(' OWNER@example.test ', 'correct synthetic password', {
      ipAddress: '192.0.2.10',
      userAgent: 'Synthetic\n Browser   1.0',
    });
    const second = await service().signIn('owner@example.test', 'correct synthetic password');
    const rows = await prisma.session.findMany({ orderBy: { createdAt: 'asc' } });

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    expect(rows).toHaveLength(2);
    const metadataRow = rows.find((row) => row.ipHash !== null);
    expect(metadataRow).toMatchObject({
      userId: ownerId,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + sessionPolicy.idleLifetimeMs),
      absoluteExpiresAt: new Date(now.getTime() + sessionPolicy.absoluteLifetimeMs),
      userAgentSummary: 'Synthetic Browser 1.0',
    });
    for (const row of rows) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.csrfSecretHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(first.token);
      expect(JSON.stringify(row)).not.toContain(first.csrfToken);
      expect(JSON.stringify(row)).not.toContain(second.token);
      expect(JSON.stringify(row)).not.toContain(second.csrfToken);
    }
    expect(metadataRow?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(metadataRow?.ipHash).not.toBe(createHash('sha256').update('192.0.2.10').digest('hex'));
    const audit = JSON.stringify(await prisma.auditEvent.findMany());
    expect(audit).toContain('auth.sign_in.succeeded');
    expect(audit).not.toContain(first.token);
    expect(audit).not.toContain(first.csrfToken);
    expect(audit).not.toContain('correct synthetic password');
  });

  it('rejects invalid credentials without creating a session', async () => {
    await expect(
      service().signIn('owner@example.test', 'wrong synthetic password'),
    ).rejects.toEqual(
      new SessionError('AUTH_CREDENTIALS_INVALID', 'Email or password is invalid.'),
    );
    await expect(
      service().signIn('missing@example.test', 'correct synthetic password'),
    ).rejects.toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID' });
    expect(await prisma.session.count()).toBe(0);
  });

  it('requires the session-bound CSRF token and advances idle expiry and last-seen', async () => {
    const issued = await service().signIn('owner@example.test', 'correct synthetic password');
    now = new Date(now.getTime() + 10 * 60 * 1_000);

    await expect(service().authenticate(issued.token, 'wrong-csrf')).rejects.toMatchObject({
      code: 'AUTH_CSRF_INVALID',
    });
    const authenticated = await service().authenticate(issued.token, issued.csrfToken);
    expect(authenticated.csrfToken).toBe(issued.csrfToken);
    expect(authenticated.actor).toMatchObject({ id: ownerId, role: 'owner', locale: 'en' });
    expect(authenticated.idleExpiresAt).toEqual(
      new Date(now.getTime() + sessionPolicy.idleLifetimeMs),
    );
    expect(await prisma.session.findUniqueOrThrow({ where: { id: issued.id } })).toMatchObject({
      lastSeenAt: now,
      idleExpiresAt: authenticated.idleExpiresAt,
    });
  });

  it('projects configured Admin capabilities into the authenticated actor', async () => {
    const restrictedAdmin = new SessionService(prisma, 'synthetic-session-secret-for-tests', {
      now: () => new Date(now),
      authorizationSettings: { adminGrants: [] },
      passwordHasher: {
        verify: async (_encodedHash: string, password: string) =>
          password === 'correct synthetic password',
      },
    });

    const issued = await restrictedAdmin.signIn('admin@example.test', 'correct synthetic password');
    const authenticated = await restrictedAdmin.authenticate(issued.token);

    expect(authenticated.actor.permissions).toContain('manageSchema');
    expect(authenticated.actor.permissions).not.toContain('manageUsers');
    expect(authenticated.actor.permissions).not.toContain('manageSettings');
  });

  it('enforces idle and absolute expiry and marks expired sessions revoked', async () => {
    const idle = await service().signIn('owner@example.test', 'correct synthetic password');
    now = new Date(idle.idleExpiresAt);
    await expect(service().authenticate(idle.token)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: idle.id } })).revokedAt).toEqual(
      now,
    );

    now = new Date('2026-09-07T10:00:00.000Z');
    const absolute = await service().signIn('owner@example.test', 'correct synthetic password');
    await prisma.session.update({
      where: { id: absolute.id },
      data: {
        lastSeenAt: new Date(absolute.absoluteExpiresAt.getTime() - 10 * 60 * 1_000),
        idleExpiresAt: absolute.absoluteExpiresAt,
      },
    });
    now = new Date(absolute.absoluteExpiresAt.getTime() - 1);
    const touched = await service().authenticate(absolute.token);
    expect(touched.idleExpiresAt).toEqual(absolute.absoluteExpiresAt);
    now = new Date(absolute.absoluteExpiresAt);
    await expect(service().authenticate(absolute.token)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
  });

  it('revokes the current or another owned session immediately', async () => {
    const current = await service().signIn('owner@example.test', 'correct synthetic password');
    const other = await service().signIn('owner@example.test', 'correct synthetic password');

    await service().revokeOwned(current.token, current.csrfToken, other.id);
    await expect(service().authenticate(other.token)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
    await service().revokeCurrent(current.token, current.csrfToken);
    await expect(service().authenticate(current.token)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
  });
});
