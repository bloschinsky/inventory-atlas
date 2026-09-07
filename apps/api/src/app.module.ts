import { Module, type DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AUTH_RUNTIME, type AuthRuntimePort } from './auth.runtime.js';
import { FoundationController } from './foundation.controller.js';
import { FOUNDATION_RUNTIME, type FoundationRuntimePort } from './foundation.runtime.js';
import { HealthController, MetaController } from './health.controller.js';

@Module({})
export class AppModule {
  static register(runtime: FoundationRuntimePort & AuthRuntimePort): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, FoundationController, HealthController, MetaController],
      providers: [
        { provide: AUTH_RUNTIME, useValue: runtime },
        { provide: FOUNDATION_RUNTIME, useValue: runtime },
      ],
    };
  }
}
