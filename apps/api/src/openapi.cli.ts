import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { createApiApplication } from './main.js';
import { createOpenApiDocument } from './openapi-document.js';
import type { FoundationRuntimePort } from './foundation.runtime.js';
import type { AuthRuntimePort } from './auth.runtime.js';
import type { CatalogRuntimePort } from './catalog.runtime.js';
import type { SchemaRuntimePort } from './schema.runtime.js';
import type { ItemsRuntimePort } from './items.runtime.js';
import type { MediaRuntimePort } from './media.runtime.js';

const output = process.argv[2];
if (!output) throw new Error('An output path is required.');
Logger.overrideLogger(false);

const documentationRuntime: FoundationRuntimePort &
  AuthRuntimePort &
  CatalogRuntimePort &
  SchemaRuntimePort &
  ItemsRuntimePort &
  MediaRuntimePort = {
  async readiness() {
    throw new Error('The documentation runtime does not serve requests.');
  },
  metadata() {
    return {
      apiVersion: 'v1',
      buildVersion: 'contract-generation',
      buildRevision: 'contract-generation',
      schemaVersion: null,
      supportedLocales: ['en', 'uk'],
    };
  },
  trustProxy() {
    return false;
  },
  authSessions() {
    throw new Error('The documentation runtime does not serve auth requests.');
  },
  authAdministration() {
    throw new Error('The documentation runtime does not serve auth requests.');
  },
  authRateLimiter() {
    throw new Error('The documentation runtime does not serve auth requests.');
  },
  secureSessionCookies() {
    return true;
  },
  catalogDictionaries() {
    throw new Error('The documentation runtime does not serve catalog requests.');
  },
  schemaFields() {
    throw new Error('The documentation runtime does not serve schema requests.');
  },
  catalogItems() {
    throw new Error('The documentation runtime does not serve Item requests.');
  },
  media() {
    throw new Error('The documentation runtime does not serve media requests.');
  },
};

const app = await createApiApplication(documentationRuntime);
try {
  const document = createOpenApiDocument(app);
  await writeFile(output, JSON.stringify(document), 'utf8');
} finally {
  await app.close();
}
