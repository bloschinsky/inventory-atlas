/** Public backend surface. Feature modules export only deliberate entry points here. */
export function foundationStatus(): { status: string } {
  return { status: 'ready' };
}

export {
  createDatabase,
  currentSchemaVersion,
  expectedSchemaVersion,
  migrateToLatest,
} from './database.js';
export {
  createSettingsClient,
  initializeInstallationSettings,
  readAdminAuthorizationSettings,
} from './settings.repository.js';
export {
  bootstrapFirstOwner,
  AuthAdministrationError,
  AuthAdministrationService,
  AuthRateLimiter,
  can,
  canManageRole,
  capabilities,
  FirstOwnerBootstrapError,
  PasswordHasher,
  permissionsFor,
  RateLimitError,
  roles,
  SessionError,
  SessionService,
  sessionPolicy,
  type BootstrappedOwner,
  type FirstOwnerBootstrapInput,
  type AuthenticatedSession,
  type ActorRole,
  type AuditMetadata,
  type AuthorizationSettings,
  type Capability,
  type InvitationSummary,
  type IssuedSession,
  type Role,
  type SessionActor,
  type SessionRequestMetadata,
  type SessionSummary,
  type UserSummary,
} from './auth/index.js';
