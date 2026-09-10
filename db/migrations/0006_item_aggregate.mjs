import { sql } from 'kysely';

// Kysely owns all DDL. Catalog owns Item/Tag writes through Prisma; Search, Storage and
// Infrastructure tables are written only through transaction-aware ports supplied a source trx.
export async function up(db) {
  await sql`
    create table items (
      id uuid primary key,
      public_id uuid not null unique,
      slug varchar(160) not null,
      category_id uuid not null references categories(id) on delete restrict on update no action,
      lifecycle_status_id uuid not null
        references lifecycle_statuses(id) on delete restrict on update no action,
      storage_node_id uuid,
      display_name text not null,
      description text,
      visibility varchar(16) not null default 'authenticated',
      version bigint not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      constraint items_slug_check check (
        slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 160
      ),
      constraint items_display_name_check check (btrim(display_name) <> ''),
      constraint items_description_check check (description is null or btrim(description) <> ''),
      constraint items_visibility_check check (
        visibility in ('public', 'authenticated', 'private', 'unlisted')
      ),
      constraint items_version_check check (version > 0),
      constraint items_updated_at_check check (updated_at >= created_at),
      constraint items_archived_at_check check (archived_at is null or archived_at >= created_at)
    );
    create index items_category_status_updated_idx
      on items (category_id, lifecycle_status_id, updated_at desc, id desc)
      where archived_at is null;
    create index items_storage_node_idx on items (storage_node_id) where storage_node_id is not null;
    create index items_updated_idx on items (updated_at desc, id desc) where archived_at is null;

    create function reject_item_public_id_change() returns trigger language plpgsql as $$
    begin
      if new.public_id is distinct from old.public_id then
        raise exception 'Item public ID cannot be changed' using errcode = '23514';
      end if;
      return new;
    end;
    $$;
    create trigger items_stable_public_id
      before update of public_id on items
      for each row execute function reject_item_public_id_change();

    create table tags (
      id uuid primary key,
      name text not null,
      name_normalized text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      constraint tags_name_check check (btrim(name) <> ''),
      constraint tags_name_normalized_check check (
        name_normalized = lower(btrim(name_normalized)) and name_normalized <> ''
      ),
      constraint tags_updated_at_check check (updated_at >= created_at),
      constraint tags_archived_at_check check (archived_at is null or archived_at >= created_at)
    );
    create index tags_active_name_idx on tags (name_normalized) where archived_at is null;

    create table item_tags (
      item_id uuid not null references items(id) on delete cascade on update no action,
      tag_id uuid not null references tags(id) on delete restrict on update no action,
      created_at timestamptz not null default now(),
      primary key (item_id, tag_id)
    );
    create index item_tags_tag_idx on item_tags (tag_id, item_id);

    alter table attribute_values
      add constraint attribute_values_item_fk foreign key (item_id)
        references items(id) on delete cascade on update no action,
      add constraint attribute_values_reference_item_fk foreign key (value_reference_item_id)
        references items(id) on delete restrict on update no action;

    create table movements (
      id uuid primary key,
      entity_type varchar(16) not null,
      item_id uuid references items(id) on delete restrict on update no action,
      storage_node_id uuid,
      from_node_id uuid,
      to_node_id uuid,
      from_path_snapshot text,
      to_path_snapshot text,
      actor_user_id uuid not null references users(id) on delete restrict on update no action,
      reason varchar(512),
      occurred_at timestamptz not null default now(),
      correlation_id varchar(128) not null,
      constraint movements_entity_type_check check (entity_type in ('item', 'storage_node')),
      constraint movements_owner_check check (
        (entity_type = 'item' and item_id is not null and storage_node_id is null)
        or (entity_type = 'storage_node' and item_id is null and storage_node_id is not null)
      ),
      constraint movements_destination_check check (
        from_node_id is distinct from to_node_id and (from_node_id is not null or to_node_id is not null)
      ),
      constraint movements_reason_check check (reason is null or btrim(reason) <> ''),
      constraint movements_correlation_id_check check (btrim(correlation_id) <> '')
    );
    create index movements_item_idx on movements (item_id, occurred_at desc, id desc)
      where item_id is not null;
    create index movements_node_idx on movements (storage_node_id, occurred_at desc, id desc)
      where storage_node_id is not null;

    create function reject_movement_mutation() returns trigger language plpgsql as $$
    begin
      raise exception 'Movements are append-only' using errcode = '23514';
    end;
    $$;
    create trigger movements_append_only
      before update or delete or truncate on movements
      for each statement execute function reject_movement_mutation();

    create table item_search (
      item_id uuid primary key references items(id) on delete cascade on update no action,
      display_name text not null,
      description text,
      category_id uuid not null references categories(id) on delete restrict on update no action,
      lifecycle_status_id uuid not null
        references lifecycle_statuses(id) on delete restrict on update no action,
      path_text text not null default '',
      public_path_text text not null default '',
      search_vector tsvector not null default ''::tsvector,
      public_search_vector tsvector not null default ''::tsvector,
      attrs jsonb not null default '{}'::jsonb,
      public_attrs jsonb not null default '{}'::jsonb,
      visibility varchar(16) not null,
      index_state varchar(16) not null default 'ready',
      item_updated_at timestamptz not null,
      indexed_at timestamptz not null default now(),
      constraint item_search_display_name_check check (btrim(display_name) <> ''),
      constraint item_search_attrs_check check (
        jsonb_typeof(attrs) = 'object' and jsonb_typeof(public_attrs) = 'object'
      ),
      constraint item_search_visibility_check check (
        visibility in ('public', 'authenticated', 'private', 'unlisted')
      ),
      constraint item_search_index_state_check check (index_state in ('ready', 'stale'))
    );
    create index item_search_vector_idx on item_search using gin (search_vector);
    create index item_search_public_vector_idx on item_search using gin (public_search_vector);
    create index item_search_attrs_idx on item_search using gin (attrs jsonb_path_ops);
    create index item_search_public_attrs_idx on item_search using gin (public_attrs jsonb_path_ops);
    create index item_search_updated_idx on item_search (item_updated_at desc, item_id desc);
    create index item_search_category_status_idx
      on item_search (category_id, lifecycle_status_id, item_updated_at desc, item_id desc);
    create table idempotency_records (
      id uuid primary key,
      actor_id uuid not null references users(id) on delete restrict on update no action,
      scope varchar(96) not null,
      key_hash char(64) not null,
      request_fingerprint char(64) not null,
      state varchar(16) not null default 'reserved',
      response_status integer,
      response_body_json jsonb,
      reservation_token_hash char(64) not null,
      lease_expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      expires_at timestamptz not null,
      completed_at timestamptz,
      constraint idempotency_actor_scope_key unique (actor_id, scope, key_hash),
      constraint idempotency_scope_check check (btrim(scope) <> ''),
      constraint idempotency_key_hash_check check (key_hash ~ '^[0-9a-f]{64}$'),
      constraint idempotency_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
      constraint idempotency_reservation_token_check check (reservation_token_hash ~ '^[0-9a-f]{64}$'),
      constraint idempotency_state_check check (state in ('reserved', 'completed', 'failed')),
      constraint idempotency_response_check check (
        (state = 'completed' and response_status between 200 and 599
          and response_body_json is not null and completed_at is not null)
        or (state <> 'completed' and response_status is null
          and response_body_json is null and completed_at is null)
      ),
      constraint idempotency_response_body_check check (
        response_body_json is null or jsonb_typeof(response_body_json) = 'object'
      ),
      constraint idempotency_lifetime_check check (
        updated_at >= created_at and lease_expires_at > created_at and expires_at > created_at
        and (completed_at is null or completed_at >= created_at)
      )
    );
    create index idempotency_expiry_idx on idempotency_records (expires_at);
    create index idempotency_reserved_lease_idx
      on idempotency_records (lease_expires_at) where state = 'reserved';
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('idempotency_records').execute();
  await db.schema.dropTable('item_search').execute();
  await sql`drop trigger movements_append_only on movements`.execute(db);
  await db.schema.dropTable('movements').execute();
  await sql`drop function reject_movement_mutation()`.execute(db);
  await sql`alter table attribute_values drop constraint attribute_values_reference_item_fk`.execute(
    db,
  );
  await sql`alter table attribute_values drop constraint attribute_values_item_fk`.execute(db);
  await db.schema.dropTable('item_tags').execute();
  await db.schema.dropTable('tags').execute();
  await sql`drop trigger items_stable_public_id on items`.execute(db);
  await db.schema.dropTable('items').execute();
  await sql`drop function reject_item_public_id_change()`.execute(db);
}
