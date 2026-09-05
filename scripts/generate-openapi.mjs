import { access } from 'node:fs/promises';

await access(new URL('../apps/api/src/app.module.ts', import.meta.url));
process.stdout.write(
  'api:spec: API composition root is ready; normalized generation begins in FND-03.\n',
);
