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
