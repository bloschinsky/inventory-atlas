import { access, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed =
  /^(?:MIT|MIT-0|ISC|0BSD|Apache-2\.0|BSD-(?:2|3)-Clause|BlueOak-1\.0\.0|CC0-1\.0|Python-2\.0|MPL-2\.0)$/u;

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  );
}

const records = new Map();
const visited = new Set();

async function visitPackage(packageDirectory) {
  const directory = await realpath(packageDirectory);
  if (visited.has(directory)) return;
  visited.add(directory);
  const manifest = path.join(directory, 'package.json');
  if (!(await exists(manifest))) return;
  const metadata = JSON.parse(await readFile(manifest, 'utf8'));
  let license = typeof metadata.license === 'object' ? metadata.license?.type : metadata.license;
  if (license === 'SEE LICENSE IN LICENSE.md') {
    const text = await readFile(path.join(directory, 'LICENSE.md'), 'utf8');
    if (/MIT License|Permission is hereby granted, free of charge/u.test(text)) license = 'MIT';
  }
  if (metadata.name && metadata.version && license) {
    records.set(`${metadata.name}@${metadata.version}`, {
      name: metadata.name,
      version: metadata.version,
      license,
    });
  }
  await visitNodeModules(path.join(directory, 'node_modules'));
  let dependencyDirectory = path.dirname(directory);
  while (
    path.basename(dependencyDirectory) !== 'node_modules' &&
    dependencyDirectory !== path.dirname(dependencyDirectory)
  ) {
    dependencyDirectory = path.dirname(dependencyDirectory);
  }
  if (path.basename(dependencyDirectory) === 'node_modules')
    await visitNodeModules(dependencyDirectory);
}

async function visitNodeModules(directory) {
  if (!(await exists(directory))) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.pnpm') continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of await readdir(target, { withFileTypes: true })) {
        await visitPackage(path.join(target, scopedEntry.name));
      }
    } else {
      await visitPackage(target);
    }
  }
}

await visitNodeModules(path.join(root, 'node_modules'));
for (const workspaceRoot of ['apps', 'packages']) {
  for (const entry of await readdir(path.join(root, workspaceRoot), { withFileTypes: true })) {
    if (entry.isDirectory())
      await visitNodeModules(path.join(root, workspaceRoot, entry.name, 'node_modules'));
  }
}

const report = [...records.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);
const rejected = report.filter(({ license }) => !allowed.test(license));
if (rejected.length) {
  throw new Error(
    `Unapproved dependency licenses: ${rejected.map(({ name, version, license }) => `${name}@${version} (${license})`).join(', ')}`,
  );
}

if (process.argv.includes('--write')) {
  await writeFile(
    path.join(root, 'docs', 'project', 'third-party-licenses.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
process.stdout.write(
  `license:check: ${report.length} installed package versions use approved licenses.\n`,
);
