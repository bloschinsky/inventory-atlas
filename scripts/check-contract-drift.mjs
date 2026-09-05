import { access } from 'node:fs/promises';

await access(new URL('../packages/contracts/src/index.ts', import.meta.url));
process.stdout.write('contracts:check: no generated OpenAPI artifacts exist before FND-03.\n');
