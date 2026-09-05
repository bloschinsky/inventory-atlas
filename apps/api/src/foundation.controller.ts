import { Controller, Get } from '@nestjs/common';
import { foundationStatus } from '@inventory-atlas/backend';

@Controller('api/v1')
export class FoundationController {
  @Get()
  getFoundation(): { status: string } {
    return foundationStatus();
  }
}
