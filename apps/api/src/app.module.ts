import { Module, type DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthAdministrationController } from './auth-administration.controller.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { FoundationController } from './foundation.controller.js';
import { FOUNDATION_RUNTIME, type FoundationRuntimePort } from './foundation.runtime.js';
import { HealthController, MetaController } from './health.controller.js';
import { CatalogDictionariesController } from './catalog-dictionaries.controller.js';
import { CATALOG_RUNTIME, type CatalogRuntimePort } from './catalog.runtime.js';
import { SchemaFieldsController } from './schema-fields.controller.js';
import { SCHEMA_RUNTIME, type SchemaRuntimePort } from './schema.runtime.js';
import { ItemsController } from './items.controller.js';
import { ITEMS_RUNTIME, type ItemsRuntimePort } from './items.runtime.js';
import { MediaController } from './media.controller.js';
import { MEDIA_RUNTIME, type MediaRuntimePort } from './media.runtime.js';
import { StorageNodesController } from './storage-nodes.controller.js';
import { STORAGE_RUNTIME, type StorageRuntimePort } from './storage.runtime.js';

@Module({})
export class AppModule {
  static register(
    runtime: FoundationRuntimePort &
      AuthRuntimePort &
      CatalogRuntimePort &
      SchemaRuntimePort &
      ItemsRuntimePort &
      MediaRuntimePort &
      StorageRuntimePort,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        AuthAdministrationController,
        CatalogDictionariesController,
        FoundationController,
        HealthController,
        ItemsController,
        MediaController,
        MetaController,
        SchemaFieldsController,
        StorageNodesController,
      ],
      providers: [
        { provide: AUTH_RUNTIME, useValue: runtime },
        { provide: FOUNDATION_RUNTIME, useValue: runtime },
        { provide: CATALOG_RUNTIME, useValue: runtime },
        { provide: SCHEMA_RUNTIME, useValue: runtime },
        { provide: ITEMS_RUNTIME, useValue: runtime },
        { provide: MEDIA_RUNTIME, useValue: runtime },
        { provide: STORAGE_RUNTIME, useValue: runtime },
      ],
    };
  }
}
