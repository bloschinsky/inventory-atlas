import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, currentSchemaVersion, expectedSchemaVersion } from './database.js';

const suite = process.env.INTEGRATION_DATABASE_URL ? describe : describe.skip;
const schema = `auth_${randomUUID().replaceAll('-', '')}`;
const migrationFolder = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const createdAt = new Date('2026-09-07T10:00:00Z');
const seenAt = new Date('2026-09-07T10:05:00Z');
const idleAt = new Date('2026-09-07T10:35:00Z');
const absoluteAt = new Date('2026-09-08T10:00:00Z');
const hash = () => randomBytes(32).toString('hex');
let admin: Pool;
let pool: Pool;
let database: ReturnType<typeof createDatabase>;
let migrator: Migrator;
let ownerId: string;

// Only synthetic fixture identifiers enter SQL; values are always parameters.
async function insert(
  table: 'users' | 'sessions' | 'invitations' | 'audit_events',
  values: Record<string, unknown>,
) {
  const entries = Object.entries(values);
  const columns = entries.map(([key]) => `"${key.replaceAll('"', '""')}"`).join(', ');
  const parameters = entries.map((_, index) => `$${index + 1}`).join(', ');
  return pool.query(
    `insert into "${table}" (${columns}) values (${parameters}) returning *`,
    entries.map(([, value]) => value),
  );
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    email_normalized: `${randomUUID()}@example.test`,
    display_name: 'Synthetic Owner',
    password_hash: '$argon2id$synthetic-schema-fixture',
    role: 'owner',
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    user_id: ownerId,
    token_hash: hash(),
    csrf_secret_hash: hash(),
    created_at: createdAt,
    last_seen_at: seenAt,
    idle_expires_at: idleAt,
    absolute_expires_at: absoluteAt,
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    email_normalized: 'invitee@example.test',
    role: 'viewer',
    token_hash: hash(),
    inviter_id: ownerId,
    created_at: createdAt,
    expires_at: absoluteAt,
    ...overrides,
  };
}

suite('FND-04 authentication schema on PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.INTEGRATION_DATABASE_URL!);
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`create schema "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    database = createDatabase(url.toString(), 1);
    migrator = new Migrator({
      db: database,
      migrationTableSchema: schema,
      provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    });
    expect((await migrator.migrateTo('0001_foundation')).error).toBeUndefined();
    await pool.query("insert into app_settings values ('default_locale', 'uk', $1)", [createdAt]);
    await pool.query('insert into installation_metadata values (true, $1)', [createdAt]);
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    ownerId = (await insert('users', user())).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await database?.destroy();
    if (admin) {
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  });

  it('upgrades foundation without changing initialized settings and is repeatable', async () => {
    expect(await currentSchemaVersion(database)).toBe(expectedSchemaVersion);
    expect((await migrator.migrateToLatest()).results).toEqual([]);
    expect((await pool.query('select * from app_settings')).rows).toEqual([
      { setting_key: 'default_locale', value_text: 'uk', updated_at: createdAt },
    ]);
    expect(
      (await pool.query('select settings_initialized_at from installation_metadata')).rows[0]
        .settings_initialized_at,
    ).toEqual(createdAt);
  });

  it('provides English, active status, bigint version and UTC timestamp defaults', async () => {
    const result = await insert('users', user());
    expect(result.rows[0]).toMatchObject({
      locale: 'en',
      status: 'active',
      version: '1',
      archived_at: null,
    });
    expect(result.rows[0].created_at).toBeInstanceOf(Date);
    expect(result.rows[0].updated_at).toBeInstanceOf(Date);
    for (const role of ['viewer', 'editor', 'owner', 'admin']) {
      expect((await insert('users', user({ role, locale: 'uk' }))).rowCount).toBe(1);
    }
  });

  it.each([
    ['role', 'public'],
    ['locale', 'de'],
    ['status', 'pending'],
    ['version', 0],
    ['email_normalized', 'Owner@example.test'],
    ['email_normalized', ' owner@example.test '],
    ['email_normalized', ''],
    ['display_name', ' '],
    ['password_hash', 'plaintext'],
  ])('rejects invalid user %s: %s', async (column, value) => {
    await expect(insert('users', user({ [column]: value }))).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('enforces unique normalized email under competing inserts, including archived accounts', async () => {
    const email = `${randomUUID()}@example.test`;
    const results = await Promise.allSettled([
      insert('users', user({ email_normalized: email, archived_at: createdAt })),
      insert('users', user({ email_normalized: email, archived_at: createdAt })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: '23505' },
    });
  });

  it.each([
    ['token_hash', 'raw-token'],
    ['csrf_secret_hash', 'raw-csrf'],
    ['ip_hash', '127.0.0.1'],
    ['last_seen_at', new Date('2026-09-07T09:59:00Z')],
    ['idle_expires_at', seenAt],
    ['absolute_expires_at', seenAt],
    ['revoked_at', new Date('2026-09-07T09:59:00Z')],
  ])('rejects invalid session %s', async (column, value) => {
    await expect(insert('sessions', session({ [column]: value }))).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('stores revocable sessions with unique token hashes and prevents orphaned sessions', async () => {
    const values = session({
      ip_hash: hash(),
      user_agent_summary: 'Synthetic Browser',
      revoked_at: seenAt,
    });
    expect((await insert('sessions', values)).rowCount).toBe(1);
    await expect(insert('sessions', { ...values, id: randomUUID() })).rejects.toMatchObject({
      code: '23505',
    });
    await expect(insert('sessions', session({ user_id: randomUUID() }))).rejects.toMatchObject({
      code: '23503',
    });
    await expect(pool.query('delete from users where id = $1', [ownerId])).rejects.toMatchObject({
      code: '23001',
    });
  });

  it.each([
    ['role', 'public'],
    ['email_normalized', 'Invitee@example.test'],
    ['token_hash', 'raw-token'],
    ['expires_at', createdAt],
    ['accepted_at', seenAt],
    ['accepted_by_id', randomUUID()],
    ['revoked_at', new Date('2026-09-07T09:59:00Z')],
    ['version', 0],
  ])('rejects invalid invitation %s', async (column, value) => {
    await expect(insert('invitations', invitation({ [column]: value }))).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('supports pending, revoked and accepted invitations and rejects contradictory terminal states', async () => {
    const pending = invitation();
    await insert('invitations', pending);
    await expect(insert('invitations', { ...pending, id: randomUUID() })).rejects.toMatchObject({
      code: '23505',
    });
    await insert('invitations', invitation({ revoked_at: seenAt }));
    await insert('invitations', invitation({ accepted_at: seenAt, accepted_by_id: ownerId }));
    for (const acceptedAt of [createdAt, seenAt, absoluteAt]) {
      await expect(
        insert(
          'invitations',
          invitation({ accepted_at: acceptedAt, accepted_by_id: ownerId, revoked_at: seenAt }),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      insert('invitations', invitation({ accepted_at: absoluteAt, accepted_by_id: ownerId })),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('invitations', invitation({ inviter_id: randomUUID() })),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps audit events append-only, including anonymous actors and correlated safe diffs', async () => {
    const event = {
      id: randomUUID(),
      actor_id: ownerId,
      action: 'auth.role_changed',
      entity_type: 'user',
      entity_id: ownerId,
      correlation_id: randomUUID(),
      request_id: randomUUID(),
      before_json: { role: 'viewer' },
      after_json: { role: 'editor' },
      ip_hash: hash(),
    };
    await insert('audit_events', event);
    await insert('audit_events', {
      ...event,
      id: randomUUID(),
      actor_id: null,
      before_json: null,
      after_json: null,
    });
    await expect(
      pool.query('update audit_events set action = $1 where id = $2', ['tampered', event.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('delete from audit_events where id = $1', [event.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('truncate audit_events')).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('audit_events', { ...event, id: randomUUID(), before_json: '[]' }),
    ).rejects.toMatchObject({ code: '23514' });
    const connection = await pool.connect();
    const rolledBackId = randomUUID();
    try {
      await connection.query('begin');
      await connection.query(
        'insert into audit_events (id, action, entity_type, correlation_id, request_id) values ($1, $2, $3, $4, $5)',
        [rolledBackId, 'auth.test', 'user', randomUUID(), randomUUID()],
      );
      await connection.query('rollback');
    } finally {
      connection.release();
    }
    expect(
      (await pool.query('select id from audit_events where id = $1', [rolledBackId])).rowCount,
    ).toBe(0);
  });

  it('indexes session management, expiry, invitations and audit access paths', async () => {
    const indexes = (
      await pool.query('select indexname from pg_indexes where schemaname = $1', [schema])
    ).rows.map((row) => row.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'users_active_role_idx',
        'sessions_user_id_created_at_idx',
        'sessions_idle_expires_at_idx',
        'sessions_absolute_expires_at_idx',
        'invitations_pending_expiry_idx',
        'audit_events_entity_idx',
        'audit_events_actor_id_created_at_idx',
        'audit_events_request_id_idx',
      ]),
    );
  });

  it('rolls back only Auth/Audit and reapplies cleanly', async () => {
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe('0001_foundation');
    expect((await pool.query('select value_text from app_settings')).rows[0].value_text).toBe('uk');
    expect(
      (
        await pool.query(
          "select to_regclass('users') as users, to_regprocedure('reject_audit_event_mutation()') as trigger_function",
        )
      ).rows[0],
    ).toEqual({ users: null, trigger_function: null });
    expect((await migrator.migrateToLatest()).error).toBeUndefined();
    expect(await currentSchemaVersion(database)).toBe(expectedSchemaVersion);
  });
});
