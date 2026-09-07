import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../database.js';
import { createSettingsClient } from '../settings.repository.js';
import { PasswordHasher } from './password-hasher.js';
import { bootstrapFirstOwner, FirstOwnerBootstrapError } from './first-owner-bootstrap.js';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = integrationDatabaseUrl ? describe : describe.skip;
const schema = `owner_bootstrap_${randomUUID().replaceAll('-', '')}`;
let adminPool: Pool;
let schemaUrl: string;
let prisma: ReturnType<typeof createSettingsClient>;

suite('first Owner bootstrap', () => {
  beforeAll(async () => {
    const parsed = new URL(integrationDatabaseUrl!);
    adminPool = new Pool({ connectionString: parsed.toString(), max: 1 });
    await adminPool.query(`create schema "${schema}"`);
    parsed.searchParams.set('options', `-c search_path=${schema}`);
    parsed.searchParams.set('schema', schema);
    schemaUrl = parsed.toString();
    await migrateToLatest(
      schemaUrl,
      fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
    );
    prisma = createSettingsClient(schemaUrl, 4);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminPool) {
      await adminPool.query(`drop schema "${schema}" cascade`);
      await adminPool.end();
    }
  });

  it('allows exactly one concurrent caller and persists an Owner credential', async () => {
    const candidates = [
      {
        email: ' FIRST@example.test ',
        displayName: ' First Owner ',
        password: 'first synthetic password',
        locale: 'uk' as const,
      },
      {
        email: 'second@example.test',
        displayName: 'Second Owner',
        password: 'second synthetic password',
        locale: 'en' as const,
      },
    ];
    const results = await Promise.allSettled(
      candidates.map((candidate) => bootstrapFirstOwner(prisma, candidate)),
    );
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      reason: { code: 'AUTH_BOOTSTRAP_UNAVAILABLE' },
    });

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    const owner = users[0];
    const success = successes[0];
    if (!owner || !success || success.status !== 'fulfilled') {
      throw new Error('Expected one bootstrapped Owner.');
    }
    expect(owner).toMatchObject({ role: 'owner', status: 'active', version: 1n });
    const winningInput = candidates.find(
      (candidate) => candidate.email.trim().toLowerCase() === owner.emailNormalized,
    );
    expect(winningInput).toBeDefined();
    expect(await new PasswordHasher().verify(owner.passwordHash, winningInput!.password)).toBe(
      true,
    );
    expect(success.value).toMatchObject({
      id: owner.id,
      email: owner.emailNormalized,
      displayName: owner.displayName,
      locale: owner.locale,
    });
  });

  it('stays unavailable without modifying the existing account', async () => {
    const before = await prisma.user.findFirstOrThrow();
    await expect(
      bootstrapFirstOwner(prisma, {
        email: 'third@example.test',
        displayName: 'Third Owner',
        password: 'third synthetic password',
      }),
    ).rejects.toEqual(
      new FirstOwnerBootstrapError(
        'AUTH_BOOTSTRAP_UNAVAILABLE',
        'First Owner bootstrap is no longer available.',
      ),
    );
    expect(await prisma.user.findMany()).toEqual([before]);
  });
});
