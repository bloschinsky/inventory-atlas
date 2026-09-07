import assert from 'node:assert/strict';
import { PasswordHasher, createSettingsClient } from '../packages/backend/dist/index.js';
import { AppModule } from '../apps/api/dist/app.module.js';
import { WorkerModule } from '../apps/worker/dist/worker.module.js';

assert.notEqual(process.getuid(), 0, 'Runtime must run as a non-root user.');
assert.ok(AppModule);
assert.ok(WorkerModule);
const hasher = new PasswordHasher();
const encoded = await hasher.hash('Synthetic runtime credential');
assert.equal(await hasher.verify(encoded, 'Synthetic runtime credential'), true);
assert.equal(await hasher.verify(encoded, 'incorrect'), false);
// Construct the generated Prisma client/pg adapter without requiring network.
const prisma = createSettingsClient('postgresql://synthetic:synthetic@localhost:5432/synthetic', 1);
await prisma.$disconnect();
process.stdout.write(
  'runtime-smoke: API/worker imports, Prisma adapter and Argon2 work as non-root.\n',
);
