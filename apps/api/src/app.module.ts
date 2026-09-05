import { Module } from '@nestjs/common';
import { FoundationController } from './foundation.controller.js';

@Module({ controllers: [FoundationController] })
export class AppModule {}
