import { sql } from 'kysely';

// Kysely owns this DDL. Prisma owns Schema field/option business writes; attribute_values is
// written only through the transaction-aware AttributeValuePort of the owning aggregate.
export async function up(db) {
  await sql`
    create table field_definitions (
      id uuid primary key,
      key varchar(64) not null,
      scope varchar(16) not null,
      category_id uuid references categories(id) on delete restrict on update no action,
      label_i18n jsonb not null,
      help_i18n jsonb,
      data_type varchar(16) not null,
      required boolean not null default false,
      repeatable boolean not null default false,
      searchable boolean not null default false,
      filterable boolean not null default false,
      sortable boolean not null default false,
      visibility varchar(16) not null default 'authenticated',
      unit varchar(32),
      default_value_json jsonb,
      validation_json jsonb not null default '{}'::jsonb,
      display_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      version bigint not null default 1,
      constraint field_definitions_key_check check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
      constraint field_definitions_scope_check check (scope in ('item', 'storage_node')),
      constraint field_definitions_data_type_check check (
        data_type in (
          'text', 'long_text', 'number', 'boolean', 'date', 'datetime',
          'select', 'multiselect', 'url', 'email', 'money', 'reference'
        )
      ),
      constraint field_definitions_visibility_check check (
        visibility in ('public', 'authenticated', 'private')
      ),
      constraint field_definitions_label_i18n_check check (
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
      constraint field_definitions_help_i18n_check check (
        help_i18n is null
        or (
          jsonb_typeof(help_i18n) = 'object'
          and help_i18n ? 'en'
          and jsonb_typeof(help_i18n -> 'en') = 'string'
          and btrim(help_i18n ->> 'en') <> ''
          and (
            not help_i18n ? 'uk'
            or (
              jsonb_typeof(help_i18n -> 'uk') = 'string'
              and btrim(help_i18n ->> 'uk') <> ''
            )
          )
          and help_i18n - 'en' - 'uk' = '{}'::jsonb
        )
      ),
      constraint field_definitions_repeatable_check check (
        not (repeatable and data_type in ('select', 'multiselect'))
      ),
      constraint field_definitions_unit_check check (unit is null or btrim(unit) <> ''),
      constraint field_definitions_validation_json_check check (
        jsonb_typeof(validation_json) = 'object'
      ),
      constraint field_definitions_display_order_check check (display_order >= 0),
      constraint field_definitions_version_check check (version > 0),
      constraint field_definitions_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    create unique index field_definitions_category_key_idx
      on field_definitions (scope, category_id, key)
      where archived_at is null and category_id is not null;
    create unique index field_definitions_scope_key_idx
      on field_definitions (scope, key)
      where archived_at is null and category_id is null;
    create index field_definitions_scope_order_idx
      on field_definitions (scope, category_id, display_order, key)
      where archived_at is null;
    create index field_definitions_category_idx on field_definitions (category_id);

    create table field_options (
      id uuid primary key,
      field_definition_id uuid not null
        references field_definitions(id) on delete restrict on update no action,
      key varchar(64) not null,
      label_i18n jsonb not null,
      display_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      constraint field_options_identity_key unique (id, field_definition_id),
      constraint field_options_key_check check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
      constraint field_options_label_i18n_check check (
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
      constraint field_options_display_order_check check (display_order >= 0),
      constraint field_options_archived_at_check check (
        archived_at is null or archived_at >= created_at
      )
    );
    create unique index field_options_active_key_idx
      on field_options (field_definition_id, key)
      where archived_at is null;
    create index field_options_order_idx
      on field_options (field_definition_id, display_order, key);

    -- item_id, storage_node_id, value_reference_item_id and value_reference_node_id receive their
    -- real foreign keys in the migrations that create items (CAT-03) and storage_nodes (STO-01);
    -- those tables cannot exist earlier because both stories depend on this schema.
    create table attribute_values (
      id uuid primary key,
      field_definition_id uuid not null
        references field_definitions(id) on delete restrict on update no action,
      item_id uuid,
      storage_node_id uuid,
      "position" integer not null,
      value_text text,
      value_number numeric(30, 10),
      value_boolean boolean,
      value_date date,
      value_datetime timestamptz,
      value_option_id uuid,
      value_money_amount numeric(20, 4),
      value_money_currency char(3),
      value_reference_item_id uuid,
      value_reference_node_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint attribute_values_option_fk foreign key (value_option_id, field_definition_id)
        references field_options (id, field_definition_id)
        on delete restrict on update no action,
      constraint attribute_values_owner_check check (
        (item_id is not null)::integer + (storage_node_id is not null)::integer = 1
      ),
      constraint attribute_values_position_check check ("position" >= 0),
      constraint attribute_values_value_group_check check (
        (value_text is not null)::integer
        + (value_number is not null)::integer
        + (value_boolean is not null)::integer
        + (value_date is not null)::integer
        + (value_datetime is not null)::integer
        + (value_option_id is not null)::integer
        + (value_money_amount is not null)::integer
        + (value_reference_item_id is not null)::integer
        + (value_reference_node_id is not null)::integer = 1
      ),
      constraint attribute_values_money_pair_check check (
        (value_money_amount is null) = (value_money_currency is null)
      ),
      constraint attribute_values_money_currency_check check (
        value_money_currency is null or value_money_currency ~ '^[A-Z]{3}$'
      ),
      constraint attribute_values_value_text_check check (
        value_text is null or btrim(value_text) <> ''
      )
    );
    create unique index attribute_values_item_position_idx
      on attribute_values (item_id, field_definition_id, "position")
      where item_id is not null;
    create unique index attribute_values_node_position_idx
      on attribute_values (storage_node_id, field_definition_id, "position")
      where storage_node_id is not null;
    create unique index attribute_values_item_option_idx
      on attribute_values (item_id, field_definition_id, value_option_id)
      where item_id is not null and value_option_id is not null;
    create unique index attribute_values_node_option_idx
      on attribute_values (storage_node_id, field_definition_id, value_option_id)
      where storage_node_id is not null and value_option_id is not null;
    create index attribute_values_definition_idx
      on attribute_values (field_definition_id, "position");
    create index attribute_values_option_idx
      on attribute_values (value_option_id)
      where value_option_id is not null;
    create index attribute_values_reference_item_idx
      on attribute_values (value_reference_item_id)
      where value_reference_item_id is not null;
    create index attribute_values_reference_node_idx
      on attribute_values (value_reference_node_id)
      where value_reference_node_id is not null;

    create function reject_schema_identity_change() returns trigger language plpgsql as $$
    declare
      identity_column text;
    begin
      foreach identity_column in array tg_argv loop
        if to_jsonb(new) ->> identity_column is distinct from to_jsonb(old) ->> identity_column then
          raise exception 'Schema identity column % cannot be changed', identity_column
            using errcode = '23514';
        end if;
      end loop;
      return new;
    end;
    $$;
    create trigger field_definitions_stable_identity
      before update of key, scope on field_definitions
      for each row execute function reject_schema_identity_change('key', 'scope');
    create trigger field_options_stable_identity
      before update of key, field_definition_id on field_options
      for each row execute function reject_schema_identity_change('key', 'field_definition_id');
  `.execute(db);
}

export async function down(db) {
  await db.schema.dropTable('attribute_values').execute();
  await db.schema.dropTable('field_options').execute();
  await db.schema.dropTable('field_definitions').execute();
  await sql`drop function reject_schema_identity_change()`.execute(db);
}
