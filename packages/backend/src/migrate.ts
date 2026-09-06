import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateToLatest } from './database.js';

export async function runMigrations(
  connectionString = process.env.KYSELY_DATABASE_URL,
  migrationFolder = path.resolve('db/migrations'),
): Promise<void> {
  if (!connectionString) throw new Error('KYSELY_DATABASE_URL is required.');
  const result = await migrateToLatest(connectionString, migrationFolder);
  for (const migration of result.results ?? []) {
    process.stdout.write(`${migration.status}: ${migration.migrationName}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrations();
}
