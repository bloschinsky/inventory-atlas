import { sql } from 'kysely';

// Storage owns this DDL and every write to storage_nodes. The dependent foreign keys are added
// here because CAT-03, CAT-02 and MED-01 deliberately created nullable Storage references before
// the Storage aggregate existed.
export async function up(db) {
  await sql`
    create extension if not exists ltree;

    create table storage_nodes (
      id uuid primary key,
      public_id uuid not null unique,
      parent_id uuid references storage_nodes(id) on delete restrict on update no action,
      path ltree not null,
      depth integer not null,
      tree_root_id uuid not null references storage_nodes(id) deferrable initially deferred,
      node_type varchar(16) not null,
      title text not null,
      code varchar(128),
      visibility varchar(16) not null default 'authenticated',
      version bigint not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      constraint storage_nodes_title_check check (btrim(title) <> ''),
      constraint storage_nodes_code_check check (code is null or btrim(code) <> ''),
      constraint storage_nodes_type_check check (
        node_type in ('site', 'room', 'zone', 'rack', 'shelf', 'container', 'custom')
      ),
      constraint storage_nodes_visibility_check check (
        visibility in ('public', 'authenticated', 'private', 'unlisted')
      ),
      constraint storage_nodes_depth_check check (depth >= 0),
      constraint storage_nodes_version_check check (version > 0),
      constraint storage_nodes_path_depth_check check (nlevel(path) - 1 = depth),
      constraint storage_nodes_label_check check (
        subpath(path, nlevel(path) - 1, 1)::text = 'n' || replace(id::text, '-', '')
      ),
      constraint storage_nodes_root_shape_check check (
        (parent_id is null and depth = 0 and tree_root_id = id)
        or (parent_id is not null and depth > 0 and tree_root_id <> id)
      ),
      constraint storage_nodes_updated_at_check check (updated_at >= created_at),
      constraint storage_nodes_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    create index storage_nodes_path_gist_idx on storage_nodes using gist (path);
    create index storage_nodes_parent_idx on storage_nodes (parent_id, title, id);
    create index storage_nodes_root_depth_idx on storage_nodes (tree_root_id, depth, id);
    create unique index storage_nodes_active_code_idx
      on storage_nodes (code) where archived_at is null and code is not null;
    create index storage_nodes_active_roots_idx
      on storage_nodes (title, id) where parent_id is null and archived_at is null;

    create function reject_storage_public_id_change() returns trigger language plpgsql as $$
    begin
      if new.public_id is distinct from old.public_id then
        raise exception 'StorageNode public ID cannot be changed' using errcode = '23514';
      end if;
      return new;
    end;
    $$;
    create trigger storage_nodes_stable_public_id
      before update of public_id on storage_nodes
      for each row execute function reject_storage_public_id_change();

    alter table items
      add constraint items_storage_node_fk foreign key (storage_node_id)
        references storage_nodes(id) on delete restrict on update no action;
    alter table attribute_values
      add constraint attribute_values_storage_node_fk foreign key (storage_node_id)
        references storage_nodes(id) on delete cascade on update no action,
      add constraint attribute_values_reference_node_fk foreign key (value_reference_node_id)
        references storage_nodes(id) on delete restrict on update no action;
    alter table movements
      add constraint movements_storage_node_fk foreign key (storage_node_id)
        references storage_nodes(id) on delete restrict on update no action,
      add constraint movements_from_node_fk foreign key (from_node_id)
        references storage_nodes(id) on delete restrict on update no action,
      add constraint movements_to_node_fk foreign key (to_node_id)
        references storage_nodes(id) on delete restrict on update no action;
    alter table media_relations
      add constraint media_relations_storage_node_fk foreign key (storage_node_id)
        references storage_nodes(id) on delete cascade on update no action;
    alter table upload_sessions
      add constraint upload_sessions_storage_node_fk foreign key (storage_node_id)
        references storage_nodes(id) on delete cascade on update no action;
  `.execute(db);
}

export async function down(db) {
  await sql`
    alter table upload_sessions drop constraint upload_sessions_storage_node_fk;
    alter table media_relations drop constraint media_relations_storage_node_fk;
    alter table movements
      drop constraint movements_to_node_fk,
      drop constraint movements_from_node_fk,
      drop constraint movements_storage_node_fk;
    alter table attribute_values
      drop constraint attribute_values_reference_node_fk,
      drop constraint attribute_values_storage_node_fk;
    alter table items drop constraint items_storage_node_fk;
    drop table storage_nodes;
    drop function reject_storage_public_id_change();
  `.execute(db);
}
