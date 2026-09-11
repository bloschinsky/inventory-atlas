import { Module, type DynamicModule } from '@nestjs/common';
import { WORKER_RUNTIME, WorkerRuntime } from './worker.runtime.js';

/**
 * The expanded-profile composition root. It owns no domain logic: the runtime it registers is
 * the same Media and job wiring the API composes in compact mode.
 */
@Module({})
export class WorkerModule {
  static register(runtime: WorkerRuntime): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: WORKER_RUNTIME, useValue: runtime }],
    };
  }
}
