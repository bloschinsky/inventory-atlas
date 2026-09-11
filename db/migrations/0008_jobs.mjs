import { sql } from 'kysely';

// Kysely owns the job queue exclusively (blueprint section 8.10). Handlers claim work with
// `for update skip locked`, hold a lease, heartbeat while running and move to retry or dead
// state on failure. No Prisma transaction ever touches this table.
export async function up(db) {
  await sql`
    create table jobs (
      id uuid primary key,
      type varchar(96) not null,
      payload_json jsonb not null,
      payload_version integer not null default 1,
      state varchar(16) not null default 'queued',
      priority integer not null default 100,
      attempt integer not null default 0,
      max_attempts integer not null default 5,
      available_at timestamptz not null default now(),
      leased_until timestamptz,
      heartbeat_at timestamptz,
      worker_id varchar(128),
      idempotency_key varchar(192) not null unique,
      progress_json jsonb not null default '{}'::jsonb,
      last_error_code varchar(96),
      last_error_message varchar(512),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      constraint jobs_type_check check (btrim(type) <> ''),
      constraint jobs_payload_check check (jsonb_typeof(payload_json) = 'object'),
      constraint jobs_payload_version_check check (payload_version >= 1),
      constraint jobs_state_check check (
        state in ('queued', 'running', 'succeeded', 'retry_wait', 'dead', 'cancelled')
      ),
      constraint jobs_priority_check check (priority between 0 and 1000),
      constraint jobs_attempt_check check (attempt >= 0 and attempt <= max_attempts),
      constraint jobs_max_attempts_check check (max_attempts between 1 and 50),
      constraint jobs_idempotency_key_check check (btrim(idempotency_key) <> ''),
      constraint jobs_progress_check check (jsonb_typeof(progress_json) = 'object'),
      -- A running job always names its worker and holds a live lease; nothing else may.
      constraint jobs_lease_check check (
        (state = 'running') = (worker_id is not null and leased_until is not null)
      ),
      constraint jobs_heartbeat_check check ((state = 'running') = (heartbeat_at is not null)),
      constraint jobs_completed_at_check check (
        (state in ('succeeded', 'dead', 'cancelled')) = (completed_at is not null)
      ),
      constraint jobs_updated_at_check check (updated_at >= created_at)
    );
    -- The claim query reads due work of the requested types in priority then age order.
    create index jobs_claim_idx on jobs (type, priority, available_at, created_at)
      where state in ('queued', 'retry_wait');
    -- Lease reclamation scans only what is actually running.
    create index jobs_lease_idx on jobs (leased_until) where state = 'running';
    -- Per-type concurrency accounting and the Admin failed-job view.
    create index jobs_type_state_idx on jobs (type, state);
    create index jobs_dead_idx on jobs (completed_at desc) where state = 'dead';
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('jobs').execute();
}
