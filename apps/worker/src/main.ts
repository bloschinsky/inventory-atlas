import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { pathToFileURL } from 'node:url';
import { WorkerModule } from './worker.module.js';

export function createWorkerApplication(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createWorkerApplication();
}
