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
export { createSettingsClient, initializeInstallationSettings } from './settings.repository.js';
export {
  bootstrapFirstOwner,
  FirstOwnerBootstrapError,
  PasswordHasher,
  SessionError,
  SessionService,
  sessionPolicy,
  type BootstrappedOwner,
  type FirstOwnerBootstrapInput,
  type AuthenticatedSession,
  type IssuedSession,
  type SessionActor,
  type SessionRequestMetadata,
} from './auth/index.js';
