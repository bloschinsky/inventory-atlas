import { pathToFileURL } from 'node:url';
import { createDatabase, currentSchemaVersion, expectedSchemaVersion } from './database.js';

export async function verifySchema(
  connectionString = process.env.KYSELY_DATABASE_URL,
): Promise<void> {
  if (!connectionString) throw new Error('KYSELY_DATABASE_URL is required.');
  const database = createDatabase(connectionString, 1);
  try {
    const actual = await currentSchemaVersion(database);
    if (actual !== expectedSchemaVersion) {
      throw new Error(
        `Database schema ${actual ?? 'uninitialized'} does not match ${expectedSchemaVersion}.`,
      );
    }
    process.stdout.write(`db:verify: schema ${actual} is current.\n`);
  } finally {
    await database.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifySchema();
}
