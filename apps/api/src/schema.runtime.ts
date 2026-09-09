import type { FieldDefinitionService } from '@inventory-atlas/backend';

export const SCHEMA_RUNTIME = Symbol('SCHEMA_RUNTIME');

export interface SchemaRuntimePort {
  schemaFields(): Pick<
    FieldDefinitionService,
    | 'listFields'
    | 'createField'
    | 'updateField'
    | 'archiveField'
    | 'createOption'
    | 'updateOption'
    | 'archiveOption'
    | 'previewConversion'
  >;
}
