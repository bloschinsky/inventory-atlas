import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import {
  FOUNDATION_RUNTIME,
  type FoundationRuntimePort,
  type ReadinessSnapshot,
} from './foundation.runtime.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(FOUNDATION_RUNTIME) private readonly runtime: FoundationRuntimePort) {}

  @Get('live')
  getLiveness(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('ready')
  async getReadiness(): Promise<ReadinessSnapshot> {
    const readiness = await this.runtime.readiness();
    if (readiness.status === 'unready') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}

@Controller('api/v1/meta')
export class MetaController {
  constructor(@Inject(FOUNDATION_RUNTIME) private readonly runtime: FoundationRuntimePort) {}

  @Get()
  getMetadata(): ReturnType<FoundationRuntimePort['metadata']> {
    return this.runtime.metadata();
  }
}
