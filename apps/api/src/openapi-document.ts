import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { contractModels } from './contract-models.js';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('Inventory Atlas API')
    .setDescription('The REST contract consumed by Inventory Atlas clients.')
    .setVersion('1.0.0')
    .build();

  return SwaggerModule.createDocument(app, configuration, {
    extraModels: [...contractModels],
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}
