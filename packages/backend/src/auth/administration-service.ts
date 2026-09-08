import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';
import { can, canManageRole, type AuthorizationSettings, type Role } from './authorization.js';
import type { SessionActor, SessionRequestMetadata } from './session-service.js';

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1_000;

export class AuthAdministrationError extends Error {
  constructor(
    readonly code:
      | 'AUTH_FORBIDDEN'
      | 'AUTH_INVITATION_INVALID'
      | 'AUTH_INVITATION_NOT_FOUND'
      | 'AUTH_INVITATION_EMAIL_EXISTS'
      | 'AUTH_USER_NOT_FOUND'
      | 'AUTH_VERSION_CONFLICT'
      | 'AUTH_OWNER_CONFIRMATION_REQUIRED'
      | 'AUTH_LAST_OWNER_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'AuthAdministrationError';
  }
}

export interface AuditMetadata extends SessionRequestMetadata {
  requestId?: string;
  correlationId?: string;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  locale: 'en' | 'uk';
  status: 'active' | 'disabled';
  version: number;
  archivedAt: Date | null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  version: number;
}

export class AuthAdministrationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
    private readonly settings: AuthorizationSettings = {},
    private readonly now: () => Date = () => new Date(),
    private readonly passwordHasher: Pick<PasswordHasher, 'hash'> = new PasswordHasher(),
  ) {}

  async listUsers(actor: SessionActor): Promise<UserSummary[]> {
    this.requireManageUsers(actor);
    const users = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return users.map(toUserSummary);
  }

  async listInvitations(actor: SessionActor): Promise<InvitationSummary[]> {
    this.requireManageUsers(actor);
    const invitations = await this.prisma.invitation.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return invitations.map(toInvitationSummary);
  }

  async issueInvitation(
    actor: SessionActor,
    input: { email: string; role: Role },
    metadata: AuditMetadata = {},
  ): Promise<InvitationSummary & { token: string }> {
    this.requireManageUsers(actor);
    const emailNormalized = input.email.trim().toLowerCase();
    if (!emailNormalized || !isRole(input.role) || !canManageRole(actor.role, input.role)) {
      throw new AuthAdministrationError('AUTH_FORBIDDEN', 'Invitation is not permitted.');
    }
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const invitation = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`lock table users, invitations in share row exclusive mode`;
      const existing = await transaction.user.findUnique({
        where: { emailNormalized },
        select: { id: true },
      });
      if (existing) {
        throw new AuthAdministrationError(
          'AUTH_INVITATION_EMAIL_EXISTS',
          'An account already exists for this email address.',
        );
      }
      await transaction.invitation.updateMany({
        where: { emailNormalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      const created = await transaction.invitation.create({
        data: {
          id: randomUUID(),
          emailNormalized,
          role: input.role,
          tokenHash: this.digest('invitation-token', token),
          inviterId: actor.id,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + invitationLifetimeMs),
        },
      });
      await this.audit(
        transaction,
        actor.id,
        'auth.invitation.issued',
        'invitation',
        created.id,
        null,
        { role: input.role },
        metadata,
      );
      return created;
    });
    return { ...toInvitationSummary(invitation), token };
  }

  async revokeInvitation(
    actor: SessionActor,
    invitationId: string,
    expectedVersion: number,
    metadata: AuditMetadata = {},
  ): Promise<void> {
    this.requireManageUsers(actor);
    const now = this.now();
    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.invitation.findUnique({ where: { id: invitationId } });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
        throw new AuthAdministrationError('AUTH_INVITATION_NOT_FOUND', 'Invitation was not found.');
      }
      if (Number(invitation.version) !== expectedVersion) throw versionConflict();
      if (!canManageRole(actor.role, invitation.role as Role)) {
        throw new AuthAdministrationError('AUTH_FORBIDDEN', 'Invitation is not permitted.');
      }
      const updated = await transaction.invitation.updateMany({
        where: { id: invitationId, version: invitation.version, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now, updatedAt: now, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw versionConflict();
      await this.audit(
        transaction,
        actor.id,
        'auth.invitation.revoked',
        'invitation',
        invitationId,
        { role: invitation.role },
        { revoked: true },
        metadata,
      );
    });
  }

  async acceptInvitation(
    token: string,
    input: { displayName: string; password: string; locale?: 'en' | 'uk' },
    metadata: AuditMetadata = {},
  ): Promise<UserSummary> {
    const displayName = input.displayName.trim();
    const locale = input.locale ?? 'en';
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !displayName ||
      !input.password ||
      !['en', 'uk'].includes(locale)
    ) {
      throw invalidInvitation();
    }
    const passwordHash = await this.passwordHasher.hash(input.password);
    const now = this.now();
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`lock table users, invitations in share row exclusive mode`;
      const invitation = await transaction.invitation.findUnique({
        where: { tokenHash: this.digest('invitation-token', token) },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= now
      ) {
        throw invalidInvitation();
      }
      const existing = await transaction.user.findUnique({
        where: { emailNormalized: invitation.emailNormalized },
        select: { id: true },
      });
      if (existing) throw invalidInvitation();
      const user = await transaction.user.create({
        data: {
          id: randomUUID(),
          emailNormalized: invitation.emailNormalized,
          displayName,
          passwordHash,
          role: invitation.role,
          locale,
          createdAt: now,
          updatedAt: now,
        },
      });
      const accepted = await transaction.invitation.updateMany({
        where: {
          id: invitation.id,
          version: invitation.version,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now, acceptedById: user.id, updatedAt: now, version: { increment: 1 } },
      });
      if (accepted.count !== 1) throw invalidInvitation();
      await this.audit(
        transaction,
        user.id,
        'auth.invitation.accepted',
        'user',
        user.id,
        null,
        { role: invitation.role },
        metadata,
      );
      return toUserSummary(user);
    });
  }

  async updateUser(
    actor: SessionActor,
    userId: string,
    input: {
      role?: Role;
      status?: 'active' | 'disabled';
      expectedVersion: number;
      ownerConfirmation?: boolean;
    },
    metadata: AuditMetadata = {},
  ): Promise<UserSummary> {
    this.requireManageUsers(actor);
    const now = this.now();
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`lock table users in share row exclusive mode`;
      const target = await transaction.user.findUnique({ where: { id: userId } });
      if (!target || target.archivedAt) throw userNotFound();
      if (Number(target.version) !== input.expectedVersion) throw versionConflict();
      const targetRole = target.role as Role;
      const nextRole = input.role ?? targetRole;
      if (
        !isRole(nextRole) ||
        !canManageRole(actor.role, targetRole) ||
        !canManageRole(actor.role, nextRole)
      ) {
        throw new AuthAdministrationError('AUTH_FORBIDDEN', 'User change is not permitted.');
      }
      const affectsOwner =
        targetRole === 'owner' && (nextRole !== 'owner' || input.status === 'disabled');
      if (affectsOwner && (actor.role !== 'owner' || input.ownerConfirmation !== true)) {
        throw new AuthAdministrationError(
          'AUTH_OWNER_CONFIRMATION_REQUIRED',
          'An Owner must explicitly confirm this Owner account change.',
        );
      }
      if (affectsOwner) await this.requireAnotherOwner(transaction, target.id);
      const updated = await transaction.user.update({
        where: { id: target.id },
        data: {
          role: nextRole,
          status: input.status ?? target.status,
          updatedAt: now,
          version: { increment: 1 },
        },
      });
      if (input.status === 'disabled' || nextRole !== targetRole) {
        await transaction.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now, updatedAt: now },
        });
      }
      await this.audit(
        transaction,
        actor.id,
        'auth.user.updated',
        'user',
        target.id,
        { role: targetRole, status: target.status },
        { role: nextRole, status: updated.status },
        metadata,
      );
      return toUserSummary(updated);
    });
  }

  async archiveUser(
    actor: SessionActor,
    userId: string,
    expectedVersion: number,
    ownerConfirmation: boolean,
    metadata: AuditMetadata = {},
  ): Promise<void> {
    this.requireManageUsers(actor);
    const now = this.now();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`lock table users in share row exclusive mode`;
      const target = await transaction.user.findUnique({ where: { id: userId } });
      if (!target || target.archivedAt) throw userNotFound();
      if (Number(target.version) !== expectedVersion) throw versionConflict();
      const targetRole = target.role as Role;
      if (!canManageRole(actor.role, targetRole))
        throw new AuthAdministrationError('AUTH_FORBIDDEN', 'User change is not permitted.');
      if (targetRole === 'owner') {
        if (actor.role !== 'owner' || !ownerConfirmation) {
          throw new AuthAdministrationError(
            'AUTH_OWNER_CONFIRMATION_REQUIRED',
            'An Owner must explicitly confirm this Owner account change.',
          );
        }
        await this.requireAnotherOwner(transaction, target.id);
      }
      await transaction.user.update({
        where: { id: target.id },
        data: { archivedAt: now, status: 'disabled', updatedAt: now, version: { increment: 1 } },
      });
      await transaction.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now, updatedAt: now },
      });
      await this.audit(
        transaction,
        actor.id,
        'auth.user.archived',
        'user',
        target.id,
        { role: targetRole, status: target.status },
        { archived: true },
        metadata,
      );
    });
  }

  private requireManageUsers(actor: SessionActor): void {
    if (!can(actor.role, 'manageUsers', this.settings)) {
      throw new AuthAdministrationError('AUTH_FORBIDDEN', 'User administration is not permitted.');
    }
  }

  private async requireAnotherOwner(
    transaction: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    excludedId: string,
  ): Promise<void> {
    const count = await transaction.user.count({
      where: { id: { not: excludedId }, role: 'owner', status: 'active', archivedAt: null },
    });
    if (count === 0)
      throw new AuthAdministrationError(
        'AUTH_LAST_OWNER_REQUIRED',
        'The last active Owner cannot be removed or demoted.',
      );
  }

  private digest(domain: string, value: string): string {
    return createHmac('sha256', this.secret).update(`${domain}\0${value}`).digest('hex');
  }

  private async audit(
    transaction: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    beforeJson: Record<string, string | boolean> | null,
    afterJson: Record<string, string | boolean> | null,
    metadata: AuditMetadata,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        actorId,
        action,
        entityType,
        entityId,
        correlationId: safeRequestId(metadata.correlationId),
        requestId: safeRequestId(metadata.requestId),
        ...(beforeJson ? { beforeJson } : {}),
        ...(afterJson ? { afterJson } : {}),
        ipHash: metadata.ipAddress ? this.digest('client-ip', metadata.ipAddress.trim()) : null,
        userAgentSummary: normalizeUserAgent(metadata.userAgent),
        createdAt: this.now(),
      },
    });
  }
}

function toUserSummary(user: {
  id: string;
  emailNormalized: string;
  displayName: string;
  role: string;
  locale: string;
  status: string;
  version: bigint;
  archivedAt: Date | null;
}): UserSummary {
  return {
    id: user.id,
    email: user.emailNormalized,
    displayName: user.displayName,
    role: user.role as Role,
    locale: user.locale as 'en' | 'uk',
    status: user.status as 'active' | 'disabled',
    version: Number(user.version),
    archivedAt: user.archivedAt,
  };
}

function toInvitationSummary(invitation: {
  id: string;
  emailNormalized: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  version: bigint;
}): InvitationSummary {
  return {
    id: invitation.id,
    email: invitation.emailNormalized,
    role: invitation.role as Role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    version: Number(invitation.version),
  };
}

function safeRequestId(value: string | undefined): string {
  const safe = value?.trim().slice(0, 128);
  return safe || randomUUID();
}

function normalizeUserAgent(value: string | undefined): string | null {
  const normalized = value
    ?.replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return normalized || null;
}

function isRole(value: string): value is Role {
  return ['viewer', 'editor', 'owner', 'admin'].includes(value);
}
function invalidInvitation(): AuthAdministrationError {
  return new AuthAdministrationError(
    'AUTH_INVITATION_INVALID',
    'Invitation is invalid or expired.',
  );
}
function userNotFound(): AuthAdministrationError {
  return new AuthAdministrationError('AUTH_USER_NOT_FOUND', 'User was not found.');
}
function versionConflict(): AuthAdministrationError {
  return new AuthAdministrationError(
    'AUTH_VERSION_CONFLICT',
    'The resource changed. Reload and retry.',
  );
}
