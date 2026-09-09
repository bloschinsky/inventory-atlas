import { sql } from 'kysely';

// Kysely owns the outbox table. Source modules write through a transaction-aware port.
export async function up(db) {
  await sql`
    create table outbox (
      id uuid primary key,
      topic varchar(96) not null,
      aggregate_type varchar(64) not null,
      aggregate_id uuid not null,
      payload_json jsonb not null,
      deduplication_key varchar(192) not null unique,
      created_at timestamptz not null default now(),
      published_at timestamptz,
      attempt integer not null default 0,
      available_at timestamptz not null default now(),
      last_error_code varchar(96),
      last_error_message varchar(512),
      constraint outbox_topic_check check (btrim(topic) <> ''),
      constraint outbox_aggregate_type_check check (btrim(aggregate_type) <> ''),
      constraint outbox_payload_check check (jsonb_typeof(payload_json) = 'object'),
      constraint outbox_deduplication_key_check check (btrim(deduplication_key) <> ''),
      constraint outbox_attempt_check check (attempt >= 0),
      constraint outbox_published_at_check check (
        published_at is null or published_at >= created_at
      )
    );
    create index outbox_pending_idx
      on outbox (available_at, created_at, id)
      where published_at is null;
    create index outbox_aggregate_idx
      on outbox (aggregate_type, aggregate_id, created_at);
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('outbox').execute();
}
