export async function up(db) {
  await db.schema
    .createTable('app_settings')
    .addColumn('setting_key', 'varchar(64)', (column) => column.primaryKey())
    .addColumn('value_text', 'text', (column) => column.notNull())
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('installation_metadata')
    .addColumn('singleton', 'boolean', (column) => column.primaryKey())
    .addColumn('settings_initialized_at', 'timestamptz', (column) => column.notNull())
    .execute();
}

export async function down(db) {
  await db.schema.dropTable('installation_metadata').execute();
  await db.schema.dropTable('app_settings').execute();
}
