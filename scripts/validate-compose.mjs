import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const variants = [
  { name: 'compact', files: [] },
  { name: 'development', files: ['infra/compose/development.yml'] },
  { name: 'expanded', files: ['infra/compose/expanded.yml'], profiles: ['expanded'] },
  { name: 'backup', files: [], profiles: ['backup'] },
  { name: 'restore', files: [], profiles: ['restore'] },
  { name: 'test', files: ['infra/compose/test.yml'] },
];

function dockerCompose(arguments_, capture = false) {
  const result = spawnSync('docker', ['compose', ...arguments_], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw new Error(`Docker Compose is required: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Docker Compose exited with status ${result.status}.`);
  return result.stdout;
}

export function assertCompactModel(model) {
  for (const name of ['db', 'migrate', 'api', 'web', 'caddy']) {
    if (!model.services?.[name]) throw new Error(`Compact Compose is missing ${name}.`);
  }
  if (model.services.db.ports)
    throw new Error('PostgreSQL must not publish a port in compact mode.');
  if (model.networks?.backend?.internal !== true) {
    throw new Error('The backend network must be internal.');
  }
  for (const name of ['postgres_data', 'media_data', 'caddy_data']) {
    if (!model.volumes?.[name]) throw new Error(`Compose is missing persistent volume ${name}.`);
  }
  for (const service of Object.values(model.services)) {
    if (service.image && !service.image.includes('@sha256:')) {
      throw new Error(`Service ${service.name ?? 'unknown'} uses an unpinned image.`);
    }
  }
}

export function assertOperationalModel(model) {
  for (const name of ['backup', 'restore']) {
    if (!model.services?.[name]) throw new Error(`Operational Compose is missing ${name}.`);
  }
  if (!model.volumes?.backup_data) {
    throw new Error('Compose is missing persistent volume backup_data.');
  }
}

export function assertDevelopmentModel(model) {
  const services = model.services ?? {};
  for (const name of ['db', 'test-db']) {
    if (!services[name] || services[name].ports?.length) {
      throw new Error('Development and test databases must exist without host ports.');
    }
  }
  for (const name of ['dev', 'tools', 'install']) {
    const volumes = services[name]?.volumes ?? [];
    if (volumes.some((volume) => volume.target === '/var/run/docker.sock')) {
      throw new Error('Only docker-tools may access the Docker socket.');
    }
    for (const directory of [
      '',
      'apps/api/',
      'apps/worker/',
      'apps/web/',
      'packages/backend/',
      'packages/config/',
      'packages/contracts/',
      'packages/i18n/',
      'packages/testkit/',
      'packages/ui/',
    ]) {
      if (
        !volumes.some(
          (volume) =>
            volume.type === 'volume' && volume.target === `/workspace/${directory}node_modules`,
        )
      ) {
        throw new Error('Every workspace dependency directory must use a Docker volume.');
      }
    }
  }
  if (!services.tools.environment.INTEGRATION_DATABASE_URL?.includes('@test-db:5432/')) {
    throw new Error('Integration tests must use the separate test database.');
  }
  if (!services.dev.ports?.every((port) => port.host_ip === '127.0.0.1')) {
    throw new Error('Development HTTP ports must bind to loopback.');
  }
}

export function validateCompose() {
  const common = ['--env-file', '.env.example', '-f', 'docker-compose.yml'];
  for (const variant of variants) {
    const fileArguments = variant.files.flatMap((file) => ['-f', file]);
    const profileArguments = (variant.profiles ?? []).flatMap((profile) => ['--profile', profile]);
    dockerCompose([...common, ...fileArguments, ...profileArguments, 'config', '--quiet']);
    process.stdout.write(`compose:validate: ${variant.name} configuration is valid.\n`);
  }
  const compact = JSON.parse(dockerCompose([...common, 'config', '--format', 'json'], true));
  assertCompactModel(compact);
  const operational = JSON.parse(
    dockerCompose(
      [...common, '--profile', 'backup', '--profile', 'restore', 'config', '--format', 'json'],
      true,
    ),
  );
  assertOperationalModel(operational);
  const developmentArguments = [
    '--env-file',
    '.env.example',
    '-f',
    'compose.dev.yml',
    '--profile',
    'tools',
    '--profile',
    'docker-tools',
    'config',
    '--format',
    'json',
  ];
  assertDevelopmentModel(JSON.parse(dockerCompose(developmentArguments, true)));
  process.stdout.write('compose:validate: compact isolation and persistence contract is valid.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateCompose();
}
