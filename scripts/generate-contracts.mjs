import { access } from 'node:fs/promises';

await access(new URL('../packages/contracts/src/index.ts', import.meta.url));
process.stdout.write(
  'contracts:generate: contract workspace is ready; OpenAPI generation begins in FND-03.\n',
);
