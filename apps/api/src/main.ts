import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pathToFileURL } from 'node:url';
import { AppModule } from './app.module.js';
import { FoundationRuntime, type FoundationRuntimePort } from './foundation.runtime.js';

export async function createApiApplication(
  runtime: FoundationRuntimePort,
): Promise<NestFastifyApplication> {
  return NestFactory.create<NestFastifyApplication>(
    AppModule.register(runtime),
    new FastifyAdapter({ trustProxy: runtime.trustProxy() }),
  );
}

async function main(): Promise<void> {
  const runtime = await FoundationRuntime.create(process.env);
  const app = await createApiApplication(runtime);
  app.enableShutdownHooks();
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
