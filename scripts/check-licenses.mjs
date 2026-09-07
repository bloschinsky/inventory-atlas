import { access, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLicenseApproved } from './license-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const workspace = ['apps', 'packages'].some(
    (folder) => path.dirname(directory) === path.join(root, folder),
  );
  if (metadata.name && metadata.version && !workspace) {
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
// Reject the development-only exception if it is reachable from a workspace's
// runtime dependencies. Follow declared edges, not every sibling in pnpm's store.
const runtimeVisited = new Set();
async function visitRuntime(directory) {
  directory = await realpath(directory);
  if (runtimeVisited.has(directory)) return;
  runtimeVisited.add(directory);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (metadata.name === 'elkjs') {
    throw new Error('elkjs is approved only for development tools, not runtime dependencies.');
  }
  const dependencies = {
    ...metadata.dependencies,
    ...metadata.optionalDependencies,
    ...Object.fromEntries(
      Object.entries(metadata.peerDependencies ?? {}).filter(
        ([name]) => !metadata.peerDependenciesMeta?.[name]?.optional,
      ),
    ),
  };
  for (const name of Object.keys(dependencies)) {
    let parent = directory;
    while (true) {
      const dependency = path.join(parent, 'node_modules', name);
      if (await exists(path.join(dependency, 'package.json'))) {
        await visitRuntime(dependency);
        break;
      }
      const next = path.dirname(parent);
      if (next === parent) {
        if (!metadata.optionalDependencies?.[name]) {
          throw new Error(`Missing runtime dependency ${name} of ${metadata.name}.`);
        }
        break;
      }
      parent = next;
    }
  }
}
await visitRuntime(root);
for (const workspaceRoot of ['apps', 'packages']) {
  for (const entry of await readdir(path.join(root, workspaceRoot), { withFileTypes: true })) {
    const directory = path.join(root, workspaceRoot, entry.name);
    if (entry.isDirectory() && (await exists(path.join(directory, 'package.json')))) {
      await visitRuntime(directory);
    }
  }
}
const rejected = report.filter((record) => !isLicenseApproved(record));
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
