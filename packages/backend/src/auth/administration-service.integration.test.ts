import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { AuthAdministrationService } from './administration-service.js';
import { permissionsFor, type Role } from './authorization.js';
import type { SessionActor } from './session-service.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `auth_admin_${randomUUID().replaceAll('-', '')}`;
let adminPool: Pool;
let prisma: ReturnType<typeof createSettingsClient>;
let service: AuthAdministrationService;
let owner: SessionActor;

suite('invitations, role changes and security audit', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    const schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    prisma = createSettingsClient(schemaUrl, 4);
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        emailNormalized: 'owner@example.test',
        displayName: 'Owner',
        passwordHash: '$argon2id$synthetic',
        role: 'owner',
      },
    });
    owner = actor(id, 'owner');
  });

  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.session.deleteMany();
    service = new AuthAdministrationService(
      prisma,
      'synthetic-administration-secret',
      {},
      () => new Date('2026-09-08T10:00:00.000Z'),
      { hash: async () => '$argon2id$accepted-synthetic' },
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('issues only a raw one-time token, accepts it once, and writes secret-free audit rows', async () => {
    const invitation = await service.issueInvitation(
      owner,
      { email: ' NEW@example.test ', role: 'editor' },
      { requestId: 'req-1', correlationId: 'corr-1', ipAddress: '192.0.2.5' },
    );
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(invitation.token);

    const accepted = await service.acceptInvitation(
      invitation.token,
      { displayName: 'New Editor', password: 'a private password', locale: 'uk' },
      { requestId: 'req-2' },
    );
    expect(accepted).toMatchObject({ email: 'new@example.test', role: 'editor', locale: 'uk' });
    await expect(
      service.acceptInvitation(invitation.token, {
        displayName: 'Again',
        password: 'a private password',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_INVITATION_INVALID' });

    const serializedAudit = JSON.stringify(await prisma.auditEvent.findMany());
    expect(serializedAudit).toContain('auth.invitation.issued');
    expect(serializedAudit).toContain('auth.invitation.accepted');
    expect(serializedAudit).not.toContain(invitation.token);
    expect(serializedAudit).not.toContain('a private password');
    expect(serializedAudit).not.toContain('new@example.test');
  });

  it('requires explicit Owner confirmation and preserves the last active Owner', async () => {
    await expect(
      service.updateUser(owner, owner.id, { role: 'editor', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'AUTH_OWNER_CONFIRMATION_REQUIRED' });
    await expect(
      service.updateUser(owner, owner.id, {
        role: 'editor',
        expectedVersion: 1,
        ownerConfirmation: true,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_LAST_OWNER_REQUIRED' });

    const secondId = randomUUID();
    await prisma.user.create({
      data: {
        id: secondId,
        emailNormalized: 'second@example.test',
        displayName: 'Second Owner',
        passwordHash: '$argon2id$synthetic',
        role: 'owner',
      },
    });
    const changed = await service.updateUser(owner, secondId, {
      role: 'editor',
      expectedVersion: 1,
      ownerConfirmation: true,
    });
    expect(changed).toMatchObject({ role: 'editor', version: 2 });
  });

  it('allows configured Admin management of non-Owners but blocks Owner authority', async () => {
    const adminId = randomUUID();
    await prisma.user.create({
      data: {
        id: adminId,
        emailNormalized: 'admin@example.test',
        displayName: 'Admin',
        passwordHash: '$argon2id$synthetic',
        role: 'admin',
      },
    });
    const admin = actor(adminId, 'admin');
    await expect(
      service.issueInvitation(admin, { email: 'viewer@example.test', role: 'viewer' }),
    ).resolves.toMatchObject({ role: 'viewer' });
    await expect(
      service.issueInvitation(admin, { email: 'owner2@example.test', role: 'owner' }),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    await expect(
      service.updateUser(admin, owner.id, { status: 'disabled', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });
});

function actor(id: string, role: Role): SessionActor {
  return {
    id,
    email: `${role}@example.test`,
    displayName: role,
    locale: 'en',
    role,
    permissions: permissionsFor(role),
  };
}
