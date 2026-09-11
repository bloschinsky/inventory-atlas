import { sql } from 'kysely';

// Kysely owns all DDL. The Media module writes assets, relations and upload sessions through
// Prisma. `media_relations.storage_node_id` has no foreign key yet; STO-01 adds it with the
// `storage_nodes` table, exactly as `items.storage_node_id` already waits for that migration.
export async function up(db) {
  await sql`
    create table media_assets (
      id uuid primary key,
      storage_key text not null unique,
      original_filename text not null,
      mime_type varchar(128) not null,
      byte_size bigint not null,
      width integer,
      height integer,
      checksum_sha256 char(64) not null,
      processing_state varchar(16) not null default 'pending',
      source_asset_id uuid references media_assets(id) on delete cascade on update no action,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      delete_after timestamptz,
      constraint media_assets_storage_key_check check (btrim(storage_key) <> ''),
      constraint media_assets_filename_check check (btrim(original_filename) <> ''),
      constraint media_assets_mime_check check (mime_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
      constraint media_assets_byte_size_check check (byte_size > 0),
      constraint media_assets_width_check check (width is null or width > 0),
      constraint media_assets_height_check check (height is null or height > 0),
      constraint media_assets_checksum_check check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      constraint media_assets_processing_state_check check (
        processing_state in ('pending', 'ready', 'failed')
      ),
      constraint media_assets_source_check check (source_asset_id is null or source_asset_id <> id),
      constraint media_assets_updated_at_check check (updated_at >= created_at)
    );
    create index media_assets_delete_after_idx on media_assets (delete_after)
      where delete_after is not null;
    create index media_assets_source_idx on media_assets (source_asset_id)
      where source_asset_id is not null;
    create index media_assets_checksum_idx on media_assets (checksum_sha256);
    create index media_assets_processing_state_idx on media_assets (processing_state)
      where processing_state <> 'ready';

    create table media_relations (
      id uuid primary key,
      asset_id uuid not null references media_assets(id) on delete cascade on update no action,
      item_id uuid references items(id) on delete cascade on update no action,
      storage_node_id uuid,
      role varchar(20) not null,
      "position" integer not null default 0,
      alt_text text,
      visibility varchar(16) not null default 'authenticated',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      constraint media_relations_owner_check check (
        (item_id is null) <> (storage_node_id is null)
      ),
      constraint media_relations_role_check check (
        role in ('primary', 'gallery', 'container_photo')
      ),
      constraint media_relations_position_check check ("position" >= 0),
      constraint media_relations_alt_text_check check (alt_text is null or btrim(alt_text) <> ''),
      constraint media_relations_visibility_check check (
        visibility in ('public', 'authenticated', 'private')
      ),
      constraint media_relations_updated_at_check check (updated_at >= created_at),
      constraint media_relations_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    -- At most one active primary image per owner. The role column is part of the key so Prisma
    -- keeps the owner relation a list instead of inferring a one-to-one relation.
    create unique index media_relations_primary_item_idx on media_relations (item_id, role)
      where role = 'primary' and archived_at is null and item_id is not null;
    create unique index media_relations_primary_node_idx
      on media_relations (storage_node_id, role)
      where role = 'primary' and archived_at is null and storage_node_id is not null;
    -- Stable gallery ordering: one active relation per owner, role and position.
    create unique index media_relations_item_position_idx
      on media_relations (item_id, role, "position")
      where archived_at is null and item_id is not null;
    create unique index media_relations_node_position_idx
      on media_relations (storage_node_id, role, "position")
      where archived_at is null and storage_node_id is not null;
    -- One asset is attached to one owner at most once while the relation is active.
    create unique index media_relations_asset_item_idx on media_relations (asset_id, item_id)
      where archived_at is null and item_id is not null;
    create unique index media_relations_asset_node_idx
      on media_relations (asset_id, storage_node_id)
      where archived_at is null and storage_node_id is not null;
    create index media_relations_asset_idx on media_relations (asset_id);
    create index media_relations_item_idx on media_relations (item_id, role, "position")
      where item_id is not null;

    create table upload_sessions (
      id uuid primary key,
      actor_id uuid not null references users(id) on delete cascade on update no action,
      item_id uuid references items(id) on delete cascade on update no action,
      storage_node_id uuid,
      declared_filename text not null,
      declared_mime_type varchar(128) not null,
      declared_byte_size bigint not null,
      temp_storage_key text not null unique,
      received_byte_size bigint,
      checksum_sha256 char(64),
      state varchar(16) not null default 'pending',
      failure_code varchar(64),
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      finalized_at timestamptz,
      constraint upload_sessions_owner_check check (
        (item_id is null) <> (storage_node_id is null)
      ),
      constraint upload_sessions_filename_check check (btrim(declared_filename) <> ''),
      constraint upload_sessions_mime_check check (declared_mime_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
      constraint upload_sessions_declared_size_check check (declared_byte_size > 0),
      constraint upload_sessions_received_size_check check (
        received_byte_size is null or received_byte_size >= 0
      ),
      constraint upload_sessions_checksum_check check (
        checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
      ),
      constraint upload_sessions_state_check check (
        state in ('pending', 'received', 'finalized', 'failed', 'expired')
      ),
      constraint upload_sessions_temp_key_check check (btrim(temp_storage_key) <> ''),
      constraint upload_sessions_expires_at_check check (expires_at > created_at),
      constraint upload_sessions_updated_at_check check (updated_at >= created_at),
      constraint upload_sessions_finalized_at_check check (
        (state = 'finalized') = (finalized_at is not null)
      )
    );
    create index upload_sessions_open_expiry_idx on upload_sessions (expires_at)
      where state in ('pending', 'received');
    create index upload_sessions_actor_idx on upload_sessions (actor_id, created_at desc);
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('upload_sessions').execute();
  await db.schema.dropTable('media_relations').execute();
  await db.schema.dropTable('media_assets').execute();
}
