import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const project = `inventory-atlas-persistence-${randomBytes(8).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const environment = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  NODE_ENV: 'test',
  HTTP_PORT: '127.0.0.1:',
  HTTPS_PORT: '127.0.0.1:',
};
const base = ['compose', '--project-name', project, '--env-file', '.env.example'];

function docker(arguments_) {
  const result = spawnSync('docker', [...base, ...arguments_], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Docker Compose is required: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Docker Compose exited with status ${result.status}.`);
}

try {
  docker(['up', '--build', '--detach', '--wait']);
  docker([
    'exec',
    '-T',
    'db',
    'psql',
    '--username',
    'inventory_atlas',
    '--dbname',
    'inventory_atlas',
    '--command',
    "create table if not exists persistence_probe(value text primary key); insert into persistence_probe values ('survives-recreate') on conflict do nothing;",
  ]);
  docker([
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    "require('node:fs').writeFileSync('/var/lib/inventory-atlas/media/persistence-probe','survives-recreate')",
  ]);
  docker(['up', '--detach', '--force-recreate', '--wait']);
  docker([
    'exec',
    '-T',
    'db',
    'psql',
    '--username',
    'inventory_atlas',
    '--dbname',
    'inventory_atlas',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    "do $$ begin if not exists (select 1 from persistence_probe where value = 'survives-recreate') then raise exception 'Database persistence probe missing'; end if; end $$;",
  ]);
  docker([
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    "if(require('node:fs').readFileSync('/var/lib/inventory-atlas/media/persistence-probe','utf8')!=='survives-recreate')process.exit(1)",
  ]);
  process.stdout.write('compose:persistence: database and media survived recreation.\n');
} finally {
  try {
    docker(['down', '--volumes', '--remove-orphans']);
  } catch (cleanupError) {
    process.stderr.write(`compose:persistence cleanup failed: ${String(cleanupError)}\n`);
  }
}
