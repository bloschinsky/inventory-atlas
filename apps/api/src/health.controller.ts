import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FOUNDATION_RUNTIME,
  type FoundationRuntimePort,
  type ReadinessSnapshot,
} from './foundation.runtime.js';

@Controller('health')
@ApiTags('health')
export class HealthController {
  constructor(@Inject(FOUNDATION_RUNTIME) private readonly runtime: FoundationRuntimePort) {}

  @Get('live')
  @ApiOperation({ operationId: 'getLiveness' })
  @ApiOkResponse({
    schema: {
      properties: { status: { enum: ['live'], type: 'string' } },
      required: ['status'],
      type: 'object',
    },
  })
  getLiveness(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('ready')
  @ApiOperation({ operationId: 'getReadiness' })
  @ApiOkResponse({ description: 'Every required component is ready.' })
  async getReadiness(): Promise<ReadinessSnapshot> {
    const readiness = await this.runtime.readiness();
    if (readiness.status === 'unready') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}

@Controller('api/v1/meta')
@ApiTags('system')
export class MetaController {
  constructor(@Inject(FOUNDATION_RUNTIME) private readonly runtime: FoundationRuntimePort) {}

  @Get()
  @ApiOperation({ operationId: 'getMetadata' })
  @ApiOkResponse({
    schema: {
      properties: {
        apiVersion: { enum: ['v1'], type: 'string' },
        buildRevision: { type: 'string' },
        buildVersion: { type: 'string' },
        schemaVersion: { nullable: true, type: 'string' },
        supportedLocales: { items: { enum: ['en', 'uk'], type: 'string' }, type: 'array' },
      },
      required: [
        'apiVersion',
        'buildRevision',
        'buildVersion',
        'schemaVersion',
        'supportedLocales',
      ],
      type: 'object',
    },
  })
  getMetadata(): ReturnType<FoundationRuntimePort['metadata']> {
    return this.runtime.metadata();
  }
}
