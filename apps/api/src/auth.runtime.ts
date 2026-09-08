import type {
  AuthAdministrationService,
  AuthRateLimiter,
  AuthenticatedSession,
  IssuedSession,
  SessionActor,
  SessionRequestMetadata,
  SessionSummary,
} from '@inventory-atlas/backend';

export const AUTH_RUNTIME = Symbol('AUTH_RUNTIME');

export interface AuthSessionPort {
  signIn(
    email: string,
    password: string,
    metadata?: SessionRequestMetadata,
  ): Promise<IssuedSession>;
  authenticate(token: string, csrfToken?: string): Promise<AuthenticatedSession>;
  revokeCurrent(token: string, csrfToken: string): Promise<void>;
  revokeOwned(token: string, csrfToken: string, sessionId: string): Promise<void>;
  listOwned(token: string): Promise<SessionSummary[]>;
  updateLocale(
    token: string,
    csrfToken: string,
    locale: 'en' | 'uk',
    metadata?: SessionRequestMetadata,
  ): Promise<SessionActor>;
}

export interface AuthRuntimePort {
  authSessions(): AuthSessionPort;
  authAdministration(): Pick<
    AuthAdministrationService,
    | 'listUsers'
    | 'listInvitations'
    | 'issueInvitation'
    | 'revokeInvitation'
    | 'acceptInvitation'
    | 'updateUser'
    | 'archiveUser'
  >;
  authRateLimiter(): AuthRateLimiter;
  secureSessionCookies(): boolean;
}
