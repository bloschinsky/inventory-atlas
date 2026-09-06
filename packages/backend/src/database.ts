import { Kysely, PostgresDialect } from 'kysely';
import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

interface FoundationDatabase {
  kysely_migration: {
    name: string;
    timestamp: string;
  };
}

export const expectedSchemaVersion = '0001_foundation';

export function createDatabase(
  connectionString: string,
  maxConnections: number,
): Kysely<FoundationDatabase> {
  return new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: maxConnections }),
    }),
  });
}

export async function migrateToLatest(
  connectionString: string,
  migrationFolder: string,
): Promise<MigrationResultSet> {
  const database = createDatabase(connectionString, 1);
  try {
    const migrator = new Migrator({
      db: database,
      provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    const result = await migrator.migrateToLatest();
    const failure = result.results?.find((item) => item.status === 'Error');
    if (failure || result.error) {
      throw result.error ?? new Error(`Migration ${failure?.migrationName ?? 'unknown'} failed.`);
    }
    return result;
  } finally {
    await database.destroy();
  }
}

export async function currentSchemaVersion(
  database: Kysely<FoundationDatabase>,
): Promise<string | null> {
  const row = await database
    .selectFrom('kysely_migration')
    .select('name')
    .orderBy('timestamp', 'desc')
    .executeTakeFirst();
  return row?.name ?? null;
}
