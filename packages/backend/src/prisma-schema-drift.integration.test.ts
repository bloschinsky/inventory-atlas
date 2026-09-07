import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from './database.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const schemaName = `prisma_drift_${crypto.randomUUID().replaceAll('-', '')}`;
const execute = promisify(execFile);
let adminPool: Pool;
let schemaUrl: string;
let temporaryDirectory: string;

suite('Prisma schema drift', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schemaName}"`);
    parsed.searchParams.set('options', `-c search_path=${schemaName}`);
    parsed.searchParams.set('schema', schemaName);
    schemaUrl = parsed.toString();
    await migrateToLatest(schemaUrl, path.join(root, 'db/migrations'));

    // Migration bookkeeping belongs to Kysely and is intentionally absent from Prisma.
    await adminPool.query(
      `drop table "${schemaName}"."kysely_migration_lock", "${schemaName}"."kysely_migration"`,
    );
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'atlas-prisma-drift-'));
  });

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query(`drop schema "${schemaName}" cascade`);
      await adminPool.end();
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('matches the schema produced by all Kysely migrations', async () => {
    const committedSchemaPath = path.join(root, 'db/prisma/schema.prisma');
    const introspectedSchemaPath = path.join(temporaryDirectory, 'schema.prisma');
    const committedSchema = await readFile(committedSchemaPath, 'utf8');
    await writeFile(
      introspectedSchemaPath,
      committedSchema.replace(
        /output\s*=\s*"[^"]+"/u,
        `output = "${path.join(temporaryDirectory, 'client').replaceAll('\\', '/')}"`,
      ),
    );

    const prismaCli = path.join(root, 'node_modules/prisma/build/index.js');
    await execute(
      process.execPath,
      [prismaCli, 'db', 'pull', '--schema', introspectedSchemaPath, '--url', schemaUrl],
      { cwd: root },
    );
    await execute(process.execPath, [prismaCli, 'format', '--schema', introspectedSchemaPath], {
      cwd: root,
    });

    const introspectedSchema = await readFile(introspectedSchemaPath, 'utf8');
    const normalize = (schema: string) =>
      schema
        .replaceAll('\r\n', '\n')
        .replace(/^\/\/\/.*(?:\n|$)/gmu, '')
        .replace(/generator client \{[\s\S]*?\}\n\n/u, '')
        .trim();
    expect(normalize(introspectedSchema)).toBe(normalize(committedSchema));
  });
});
