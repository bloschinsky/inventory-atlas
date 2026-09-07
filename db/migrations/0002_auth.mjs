import { sql } from 'kysely';

// Kysely owns this DDL; Prisma owns Auth/Audit business writes.
export async function up(db) {
  await sql`
    create table users (
      id uuid primary key,
      email_normalized text not null unique,
      display_name text not null,
      password_hash text not null,
      role text not null,
      locale text not null default 'en',
      status text not null default 'active',
      last_login_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      version bigint not null default 1,
      constraint users_email_normalized_check check (
        email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''
      ),
      constraint users_display_name_check check (btrim(display_name) <> ''),
      constraint users_password_hash_check check (password_hash like '$argon2id$%'),
      constraint users_role_check check (role in ('viewer', 'editor', 'owner', 'admin')),
      constraint users_locale_check check (locale in ('en', 'uk')),
      constraint users_status_check check (status in ('active', 'disabled')),
      constraint users_version_check check (version > 0)
    );
    create index users_active_role_idx on users (role)
      where status = 'active' and archived_at is null;

    create table sessions (
      id uuid primary key,
      user_id uuid not null references users(id) on delete restrict,
      token_hash text not null unique,
      csrf_secret_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_seen_at timestamptz not null,
      idle_expires_at timestamptz not null,
      absolute_expires_at timestamptz not null,
      revoked_at timestamptz,
      ip_hash text,
      user_agent_summary varchar(256),
      constraint sessions_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
      constraint sessions_csrf_secret_hash_check check (csrf_secret_hash ~ '^[0-9a-f]{64}$'),
      constraint sessions_ip_hash_check check (ip_hash ~ '^[0-9a-f]{64}$'),
      constraint sessions_lifetime_check check (
        last_seen_at >= created_at and idle_expires_at > last_seen_at
        and idle_expires_at <= absolute_expires_at
      ),
      constraint sessions_revoked_at_check check (revoked_at >= created_at)
    );
    create index sessions_user_id_created_at_idx on sessions (user_id, created_at);
    create index sessions_idle_expires_at_idx on sessions (idle_expires_at)
      where revoked_at is null;
    create index sessions_absolute_expires_at_idx on sessions (absolute_expires_at);

    create table invitations (
      id uuid primary key,
      email_normalized text not null,
      role text not null,
      token_hash text not null unique,
      inviter_id uuid not null references users(id) on delete restrict,
      accepted_by_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      expires_at timestamptz not null,
      accepted_at timestamptz,
      revoked_at timestamptz,
      version bigint not null default 1,
      constraint invitations_email_normalized_check check (
        email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''
      ),
      constraint invitations_role_check check (role in ('viewer', 'editor', 'owner', 'admin')),
      constraint invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
      constraint invitations_expiry_check check (expires_at > created_at),
      constraint invitations_acceptance_check check (
        (accepted_at is null) = (accepted_by_id is null)
        and (accepted_at is null or (
          accepted_at >= created_at and accepted_at < expires_at and revoked_at is null
        ))
      ),
      constraint invitations_revoked_at_check check (revoked_at >= created_at),
      constraint invitations_version_check check (version > 0)
    );
    create index invitations_email_normalized_idx on invitations (email_normalized);
    create index invitations_inviter_id_idx on invitations (inviter_id);
    create index invitations_accepted_by_id_idx on invitations (accepted_by_id);
    create index invitations_pending_expiry_idx on invitations (expires_at)
      where accepted_at is null and revoked_at is null;

    create table audit_events (
      id uuid primary key,
      actor_id uuid references users(id) on delete restrict,
      action varchar(96) not null,
      entity_type varchar(64) not null,
      entity_id uuid,
      correlation_id varchar(128) not null,
      request_id varchar(128) not null,
      before_json jsonb,
      after_json jsonb,
      ip_hash text,
      user_agent_summary varchar(256),
      created_at timestamptz not null default now(),
      constraint audit_events_action_check check (btrim(action) <> ''),
      constraint audit_events_entity_type_check check (btrim(entity_type) <> ''),
      constraint audit_events_correlation_id_check check (btrim(correlation_id) <> ''),
      constraint audit_events_request_id_check check (btrim(request_id) <> ''),
      constraint audit_events_before_check check (jsonb_typeof(before_json) = 'object'),
      constraint audit_events_after_check check (jsonb_typeof(after_json) = 'object'),
      constraint audit_events_ip_hash_check check (ip_hash ~ '^[0-9a-f]{64}$')
    );
    create index audit_events_created_at_idx on audit_events (created_at, id);
    create index audit_events_actor_id_created_at_idx on audit_events (actor_id, created_at);
    create index audit_events_entity_idx on audit_events (entity_type, entity_id, created_at);
    create index audit_events_correlation_id_idx on audit_events (correlation_id);
    create index audit_events_request_id_idx on audit_events (request_id);

    create function reject_audit_event_mutation() returns trigger language plpgsql as $$
    begin
      raise exception 'Audit events are append-only' using errcode = '23514';
    end;
    $$;
    create trigger audit_events_append_only
      before update or delete or truncate on audit_events
      for each statement execute function reject_audit_event_mutation();
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('audit_events').execute();
  await sql`drop function reject_audit_event_mutation()`.execute(db);
  await db.schema.dropTable('invitations').execute();
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('users').execute();
}
