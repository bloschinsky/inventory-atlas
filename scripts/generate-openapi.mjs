import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { format, resolveConfig } from 'prettier';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prettierOptions = (await resolveConfig(path.join(repositoryRoot, 'package.json'))) ?? {};
export const openApiPath = path.join(repositoryRoot, 'docs', 'api', 'openapi.json');
const unorderedArrayKeys = new Set(['enum', 'required', 'tags']);

function canonicalText(value) {
  return JSON.stringify(value);
}

export function normalizeOpenApi(value, parentKey = '') {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeOpenApi(entry));
    return unorderedArrayKeys.has(parentKey)
      ? normalized.toSorted((left, right) =>
          canonicalText(left).localeCompare(canonicalText(right)),
        )
      : normalized;
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'x-spec-checksum')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeOpenApi(entry, key)]),
  );
}

export function checksumForOpenApi(document) {
  return createHash('sha256')
    .update(canonicalText(normalizeOpenApi(document)))
    .digest('hex');
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)),
    );
  });
}

export async function generateOpenApi(outputPath = openApiPath) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'inventory-atlas-openapi-'));
  const rawPath = path.join(temporaryDirectory, 'raw.json');
  try {
    // The development condition resolves workspace packages to their sources, so the
    // contract never depends on a prior build or a stale dist directory.
    await run('pnpm', [
      '--filter',
      '@inventory-atlas/api',
      'exec',
      'tsx',
      '--conditions=development',
      'src/openapi.cli.ts',
      rawPath,
    ]);
    const rawDocument = JSON.parse(await readFile(rawPath, 'utf8'));
    const checksum = checksumForOpenApi(rawDocument);
    const normalized = normalizeOpenApi(rawDocument);
    normalized['x-spec-checksum'] = checksum;
    await writeFile(
      outputPath,
      await format(JSON.stringify(normalized), { ...prettierOptions, parser: 'json' }),
      'utf8',
    );
    return { checksum, document: normalized };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checksum } = await generateOpenApi();
  process.stdout.write(`api:spec: wrote docs/api/openapi.json (${checksum}).\n`);
}
