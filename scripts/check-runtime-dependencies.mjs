import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLicenseApproved } from './license-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = new Set([
  'prisma',
  '@prisma/studio-core',
  'elkjs',
  'typescript',
  'tsx',
  'esbuild',
  'vite',
  'vitest',
  'eslint',
  'prettier',
  '@hey-api/openapi-ts',
]);

// Inspect the physical store too: unreachable development files must not ship.
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(target);
    else if (entry.name === 'package.json' && entry.isFile()) {
      const metadata = JSON.parse(await readFile(target, 'utf8'));
      if (!metadata.name || !metadata.version) continue;
      if (forbidden.has(metadata.name)) {
        throw new Error(`Development package ${metadata.name} is present in the runtime image.`);
      }
      // Nested package.json files can describe module format without a license.
      // Package roots in the store always sit immediately under node_modules.
      const parent = path.dirname(directory);
      if (
        path.basename(parent) === 'node_modules' ||
        (path.basename(parent).startsWith('@') &&
          path.basename(path.dirname(parent)) === 'node_modules')
      ) {
        if (!isLicenseApproved(metadata, true)) {
          throw new Error(`Unapproved runtime license: ${metadata.name}@${metadata.version}.`);
        }
      }
    }
  }
}
await check(path.join(root, 'node_modules'));
process.stdout.write(
  'runtime-dependencies: production store has no development tooling or unapproved licenses.\n',
);
