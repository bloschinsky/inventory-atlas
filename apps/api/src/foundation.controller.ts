import { Controller, Get } from '@nestjs/common';
import { foundationStatus } from '@inventory-atlas/backend';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { contractModels } from './contract-models.js';

@Controller('api/v1')
@ApiTags('foundation')
@ApiExtraModels(...contractModels)
export class FoundationController {
  @Get()
  @ApiOperation({ operationId: 'getFoundationStatus' })
  @ApiOkResponse({
    schema: {
      properties: { status: { example: 'ready', type: 'string' } },
      required: ['status'],
      type: 'object',
    },
  })
  getFoundation(): { status: string } {
    return foundationStatus();
  }
}
