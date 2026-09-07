import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';

// A public synthetic hash keeps unknown-account and known-account failures on
// the same Argon2id verification path. It is not a credential or a secret.
const invalidCredentialHash =
  '$argon2id$v=19$m=65536,p=4,t=3$BwcHBwcHBwcHBwcHBwcHBw$yTYWhyB/QYxR72ZtgzjFAhjqE0PE+/c00bF2BfoTafE';

export const sessionPolicy = Object.freeze({
  absoluteLifetimeMs: 30 * 24 * 60 * 60 * 1_000,
  idleLifetimeMs: 30 * 60 * 1_000,
  tokenBytes: 32,
});

export interface SessionActor {
  id: string;
  email: string;
  displayName: string;
  locale: 'en' | 'uk';
  role: 'viewer' | 'editor' | 'admin' | 'owner';
}

export interface IssuedSession {
  id: string;
  token: string;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  actor: SessionActor;
}

export type AuthenticatedSession = Omit<IssuedSession, 'token'>;

export interface SessionRequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export class SessionError extends Error {
  constructor(
    readonly code:
      | 'AUTH_CREDENTIALS_INVALID'
      | 'AUTH_SESSION_INVALID'
      | 'AUTH_CSRF_INVALID'
      | 'AUTH_SESSION_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

interface SessionServiceOptions {
  now?: () => Date;
  passwordHasher?: Pick<PasswordHasher, 'verify'>;
}

/** Owns opaque session issuance, validation, expiry and revocation. */
export class SessionService {
  private readonly now: () => Date;
  private readonly passwordHasher: Pick<PasswordHasher, 'verify'>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
    options: SessionServiceOptions = {},
  ) {
    if (!secret) throw new Error('A session hashing secret is required.');
    this.now = options.now ?? (() => new Date());
    this.passwordHasher = options.passwordHasher ?? new PasswordHasher();
  }

  async signIn(
    email: string,
    password: string,
    metadata: SessionRequestMetadata = {},
  ): Promise<IssuedSession> {
    const emailNormalized = email.trim().toLowerCase();
    const user = emailNormalized
      ? await this.prisma.user.findUnique({ where: { emailNormalized } })
      : null;
    const credentialMatches = await this.passwordHasher.verify(
      user?.passwordHash ?? invalidCredentialHash,
      password,
    );
    if (!user || !credentialMatches || user.status !== 'active' || user.archivedAt !== null) {
      throw new SessionError('AUTH_CREDENTIALS_INVALID', 'Email or password is invalid.');
    }

    const now = this.now();
    const absoluteExpiresAt = new Date(now.getTime() + sessionPolicy.absoluteLifetimeMs);
    const idleExpiresAt = new Date(now.getTime() + sessionPolicy.idleLifetimeMs);
    const token = this.randomToken();
    const csrfToken = this.csrfFor(token);
    const session = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.session.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          tokenHash: this.digest('session-token', token),
          csrfSecretHash: this.digest('csrf-token', csrfToken),
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
          ipHash: metadata.ipAddress ? this.digest('client-ip', metadata.ipAddress.trim()) : null,
          userAgentSummary: normalizeUserAgent(metadata.userAgent),
        },
        select: { id: true },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now, updatedAt: now },
      });
      return created;
    });

    return {
      id: session.id,
      token,
      csrfToken,
      idleExpiresAt,
      absoluteExpiresAt,
      actor: actorFromUser(user),
    };
  }

  async authenticate(token: string, csrfToken?: string): Promise<AuthenticatedSession> {
    if (!token) throw invalidSession();
    const now = this.now();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.digest('session-token', token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime() ||
      session.user.status !== 'active' ||
      session.user.archivedAt !== null
    ) {
      if (session && !session.revokedAt) {
        await this.prisma.session.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: now, updatedAt: now },
        });
      }
      throw invalidSession();
    }
    if (
      csrfToken !== undefined &&
      !safeHashEquals(session.csrfSecretHash, this.digest('csrf-token', csrfToken))
    ) {
      throw new SessionError('AUTH_CSRF_INVALID', 'CSRF token is invalid.');
    }

    const idleExpiresAt = new Date(
      Math.min(now.getTime() + sessionPolicy.idleLifetimeMs, session.absoluteExpiresAt.getTime()),
    );
    const touched = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: { lastSeenAt: now, idleExpiresAt, updatedAt: now },
    });
    if (touched.count !== 1) throw invalidSession();

    return {
      id: session.id,
      csrfToken: this.csrfFor(token),
      idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      actor: actorFromUser(session.user),
    };
  }

  async revokeCurrent(token: string, csrfToken: string): Promise<void> {
    const current = await this.authenticate(token, csrfToken);
    const now = this.now();
    await this.prisma.session.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: now, updatedAt: now },
    });
  }

  async revokeOwned(token: string, csrfToken: string, sessionId: string): Promise<void> {
    const current = await this.authenticate(token, csrfToken);
    const now = this.now();
    const revoked = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: current.actor.id, revokedAt: null },
      data: { revokedAt: now, updatedAt: now },
    });
    if (revoked.count !== 1) {
      throw new SessionError('AUTH_SESSION_NOT_FOUND', 'Session was not found.');
    }
  }

  private randomToken(): string {
    return randomBytes(sessionPolicy.tokenBytes).toString('base64url');
  }

  private csrfFor(sessionToken: string): string {
    return createHmac('sha256', this.secret)
      .update('inventory-atlas:csrf-secret:v1\0', 'utf8')
      .update(sessionToken, 'utf8')
      .digest('base64url');
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.secret)
      .update(`inventory-atlas:${purpose}:v1\0`, 'utf8')
      .update(value, 'utf8')
      .digest('hex');
  }
}

function actorFromUser(user: {
  id: string;
  emailNormalized: string;
  displayName: string;
  locale: string;
  role: string;
}): SessionActor {
  return {
    id: user.id,
    email: user.emailNormalized,
    displayName: user.displayName,
    locale: user.locale as SessionActor['locale'],
    role: user.role as SessionActor['role'],
  };
}

function normalizeUserAgent(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, 256) : null;
}

function safeHashEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function invalidSession(): SessionError {
  return new SessionError('AUTH_SESSION_INVALID', 'Session is invalid or expired.');
}
