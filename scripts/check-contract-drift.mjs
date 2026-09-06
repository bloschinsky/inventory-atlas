import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateContracts, generatedRoot } from './generate-contracts.mjs';
import { openApiPath } from './generate-openapi.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function snapshot(target) {
  if (!(await exists(target))) return new Map();
  const entries = await readdir(target, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  return new Map(
    await Promise.all(
      files.map(async (file) => [
        path.relative(repositoryRoot, file),
        await readFile(file, 'utf8'),
      ]),
    ),
  );
}

export function driftedPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((file) => before.get(file) !== after.get(file)).sort();
}

export async function checkContractDrift() {
  const before = await snapshot(generatedRoot);
  before.set(
    path.relative(repositoryRoot, openApiPath),
    (await exists(openApiPath)) ? await readFile(openApiPath, 'utf8') : '',
  );
  await generateContracts();
  const after = await snapshot(generatedRoot);
  after.set(path.relative(repositoryRoot, openApiPath), await readFile(openApiPath, 'utf8'));

  const drift = driftedPaths(before, after);
  if (drift.length) {
    throw new Error(
      `Generated API contract drift detected:\n${drift.join('\n')}\nRun pnpm contracts:generate and commit the results.`,
    );
  }
  return after.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await checkContractDrift();
  process.stdout.write(
    `contracts:check: ${count} generated artifacts match the normalized OpenAPI source.\n`,
  );
}
