import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { parseEnvironment } from '@inventory-atlas/config';
import { pathToFileURL } from 'node:url';
import { WorkerModule } from './worker.module.js';
import { WorkerRuntime } from './worker.runtime.js';

export function createWorkerApplication(runtime: WorkerRuntime): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule.register(runtime));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuration = parseEnvironment(process.env);
  if (configuration.jobRunnerMode !== 'worker') {
    throw new Error('The worker entrypoint requires JOB_RUNNER_MODE=worker.');
  }
  const runtime = await WorkerRuntime.create(process.env);
  const app = await createWorkerApplication(runtime);
  app.enableShutdownHooks();
  runtime.start();
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await app.close();
}
