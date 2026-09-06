import { access } from 'node:fs/promises';

const required = [
  'apps/api',
  'apps/worker',
  'apps/web',
  'packages/backend',
  'packages/contracts',
  'packages/config',
  'packages/i18n',
  'packages/ui',
  'packages/testkit',
  'db/migrations',
  'db/seeds',
  'db/fixtures',
  'infra/docker',
  'infra/caddy',
  'infra/compose',
  'scripts',
  'docs/api',
  'docs/operations',
  'docs/security',
  'pnpm-lock.yaml',
  'docker-compose.yml',
  'compose.dev.yml',
  'infra/docker/development.Dockerfile',
  'infra/docker/caddy.Dockerfile',
  '.env.example',
  'infra/docker/backend.Dockerfile',
  'infra/docker/web.Dockerfile',
  'infra/caddy/Caddyfile',
  'db/prisma/schema.prisma',
  'packages/backend/src/generated/prisma/client.ts',
];

await Promise.all(required.map((entry) => access(new URL(`../${entry}`, import.meta.url))));
process.stdout.write(`clean-checkout: ${required.length} required workspace paths are present.\n`);
