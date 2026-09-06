import { Module, type DynamicModule } from '@nestjs/common';
import { FoundationController } from './foundation.controller.js';
import { FOUNDATION_RUNTIME, type FoundationRuntimePort } from './foundation.runtime.js';
import { HealthController, MetaController } from './health.controller.js';

@Module({})
export class AppModule {
  static register(runtime: FoundationRuntimePort): DynamicModule {
    return {
      module: AppModule,
      controllers: [FoundationController, HealthController, MetaController],
      providers: [{ provide: FOUNDATION_RUNTIME, useValue: runtime }],
    };
  }
}
