import { Module, type DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthAdministrationController } from './auth-administration.controller.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { FoundationController } from './foundation.controller.js';
import { FOUNDATION_RUNTIME, type FoundationRuntimePort } from './foundation.runtime.js';
import { HealthController, MetaController } from './health.controller.js';
import { CatalogDictionariesController } from './catalog-dictionaries.controller.js';
import { CATALOG_RUNTIME, type CatalogRuntimePort } from './catalog.runtime.js';

@Module({})
export class AppModule {
  static register(
    runtime: FoundationRuntimePort & AuthRuntimePort & CatalogRuntimePort,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        AuthAdministrationController,
        CatalogDictionariesController,
        FoundationController,
        HealthController,
        MetaController,
      ],
      providers: [
        { provide: AUTH_RUNTIME, useValue: runtime },
        { provide: FOUNDATION_RUNTIME, useValue: runtime },
        { provide: CATALOG_RUNTIME, useValue: runtime },
      ],
    };
  }
}
