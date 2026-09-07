import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'atlas-prisma-'));
const exec = promisify(execFile);
try {
  const source = await readFile(path.join(root, 'db/prisma/schema.prisma'), 'utf8');
  const schema = source.replace(/output\s*=\s*"[^"]+"/u, 'output = "./client"');
  if (source === schema) throw new Error('Prisma generator output was not found.');
  const schemaFile = path.join(temporary, 'schema.prisma');
  await writeFile(schemaFile, schema);
  // Exercise @prisma/config and its patched deepmerge-ts through the actual CLI.
  const configFile = path.join(temporary, 'prisma.config.mjs');
  const configModule = pathToFileURL(path.join(root, 'node_modules/prisma/config.js')).href;
  await writeFile(
    configFile,
    [
      `import { defineConfig } from ${JSON.stringify(configModule)};`,
      `export default defineConfig({ schema: ${JSON.stringify(schemaFile)} });`,
      '',
    ].join('\n'),
  );
  const cli = path.join(root, 'node_modules/prisma/build/index.js');
  for (const command of ['validate', 'generate']) {
    await exec(process.execPath, [cli, command, '--config', configFile], { cwd: root });
  }
  await access(path.join(temporary, 'client/client.ts'));
  process.stdout.write(
    'prisma:check: pinned CLI validates and generates the existing schema in isolation.\n',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
