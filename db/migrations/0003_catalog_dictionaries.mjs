import { sql } from 'kysely';

// Kysely owns this DDL; Prisma owns Catalog dictionary business writes.
export async function up(db) {
  await sql`
    create table categories (
      id uuid primary key,
      parent_id uuid references categories(id) on delete restrict on update no action,
      key varchar(64) not null unique,
      label_i18n jsonb not null,
      display_template text,
      display_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      version bigint not null default 1,
      constraint categories_parent_check check (parent_id is null or parent_id <> id),
      constraint categories_key_check check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
      constraint categories_label_i18n_check check (
        jsonb_typeof(label_i18n) = 'object'
        and label_i18n ? 'en'
        and jsonb_typeof(label_i18n -> 'en') = 'string'
        and btrim(label_i18n ->> 'en') <> ''
        and (
          not label_i18n ? 'uk'
          or (
            jsonb_typeof(label_i18n -> 'uk') = 'string'
            and btrim(label_i18n ->> 'uk') <> ''
          )
        )
        and label_i18n - 'en' - 'uk' = '{}'::jsonb
      ),
      constraint categories_display_template_check check (
        display_template is null or btrim(display_template) <> ''
      ),
      constraint categories_display_order_check check (display_order >= 0),
      constraint categories_version_check check (version > 0),
      constraint categories_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    create index categories_parent_order_idx
      on categories (parent_id, display_order, key);
    create index categories_active_order_idx
      on categories (display_order, key)
      where archived_at is null;

    create function reject_category_cycle() returns trigger
      language plpgsql set search_path from current as $$
    begin
      if new.parent_id is null then
        return new;
      end if;
      if exists (
        with recursive ancestors(id, parent_id) as (
          select id, parent_id from categories where id = new.parent_id
          union
          select category.id, category.parent_id
          from categories category
          join ancestors ancestor on category.id = ancestor.parent_id
        )
        select 1 from ancestors where id = new.id
      ) then
        raise exception 'Category hierarchy cannot contain a cycle' using errcode = '23514';
      end if;
      return new;
    end;
    $$;
    create constraint trigger categories_no_cycle
      after insert or update of parent_id on categories
      deferrable initially immediate
      for each row execute function reject_category_cycle();

    create table lifecycle_statuses (
      id uuid primary key,
      key varchar(64) not null unique,
      label_i18n jsonb not null,
      color_token varchar(64) not null,
      display_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      version bigint not null default 1,
      constraint lifecycle_statuses_key_check check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
      constraint lifecycle_statuses_label_i18n_check check (
        jsonb_typeof(label_i18n) = 'object'
        and label_i18n ? 'en'
        and jsonb_typeof(label_i18n -> 'en') = 'string'
        and btrim(label_i18n ->> 'en') <> ''
        and (
          not label_i18n ? 'uk'
          or (
            jsonb_typeof(label_i18n -> 'uk') = 'string'
            and btrim(label_i18n ->> 'uk') <> ''
          )
        )
        and label_i18n - 'en' - 'uk' = '{}'::jsonb
      ),
      constraint lifecycle_statuses_color_token_check check (
        color_token ~ '^[a-z][a-z0-9]*(\\.[a-z0-9]+)*$'
      ),
      constraint lifecycle_statuses_display_order_check check (display_order >= 0),
      constraint lifecycle_statuses_version_check check (version > 0),
      constraint lifecycle_statuses_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    create index lifecycle_statuses_active_order_idx
      on lifecycle_statuses (display_order, key)
      where archived_at is null;

    create function reject_dictionary_key_change() returns trigger language plpgsql as $$
    begin
      if new.key <> old.key then
        raise exception 'Dictionary stable keys cannot be changed' using errcode = '23514';
      end if;
      return new;
    end;
    $$;
    create trigger categories_stable_key
      before update of key on categories
      for each row execute function reject_dictionary_key_change();
    create trigger lifecycle_statuses_stable_key
      before update of key on lifecycle_statuses
      for each row execute function reject_dictionary_key_change();
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('lifecycle_statuses').execute();
  await db.schema.dropTable('categories').execute();
  await sql`drop function reject_category_cycle()`.execute(db);
  await sql`drop function reject_dictionary_key_change()`.execute(db);
}
