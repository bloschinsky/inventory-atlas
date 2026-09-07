import type {
  AuthenticatedSession,
  IssuedSession,
  SessionRequestMetadata,
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
}

export interface AuthRuntimePort {
  authSessions(): AuthSessionPort;
  secureSessionCookies(): boolean;
}
