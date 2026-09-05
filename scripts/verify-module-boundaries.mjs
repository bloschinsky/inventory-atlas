import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['apps', 'packages'];
const extensions = new Set(['.js', '.mjs', '.ts', '.vue']);
const ignoredParts = new Set(['node_modules', 'dist', 'coverage']);

function normalize(file) {
  return file.split(path.sep).join('/');
}

export function importedSpecifiers(source) {
  const imports = [];
  const pattern =
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[1] ?? match[2]);
  return imports.filter(Boolean);
}

function frontendLayer(file) {
  return /apps\/web\/src\/(app|pages|features|entities|shared)\//u.exec(file)?.[1];
}

function resolvedFrontendLayer(file, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = normalize(path.resolve(repositoryRoot, path.dirname(file), specifier));
  return frontendLayer(path.relative(repositoryRoot, resolved).split(path.sep).join('/'));
}

export function violationsForSource(file, source) {
  const normalizedFile = normalize(file);
  const violations = [];
  const layer = frontendLayer(normalizedFile);
  const deniedByLayer = {
    shared: new Set(['app', 'pages', 'features', 'entities']),
    entities: new Set(['app', 'pages', 'features']),
    features: new Set(['app', 'pages']),
    pages: new Set(['app']),
  };

  for (const specifier of importedSpecifiers(source)) {
    if (
      (specifier === 'primevue' ||
        specifier.startsWith('primevue/') ||
        specifier.startsWith('@primeuix/')) &&
      !normalizedFile.startsWith('packages/ui/')
    ) {
      violations.push(
        `${normalizedFile}: PrimeVue and PrimeUIX may be imported only inside packages/ui (${specifier})`,
      );
    }
    if (specifier.startsWith('@inventory-atlas/backend/')) {
      violations.push(
        `${normalizedFile}: backend internals must be consumed through a public package surface (${specifier})`,
      );
    }
    if (layer && deniedByLayer[layer]) {
      const targetLayer = resolvedFrontendLayer(normalizedFile, specifier);
      if (targetLayer && deniedByLayer[layer].has(targetLayer)) {
        violations.push(
          `${normalizedFile}: frontend ${layer} may not import ${targetLayer} (${specifier})`,
        );
      }
    }
  }
  if (/apps\/web\/src\/app\/stores\//u.test(normalizedFile)) {
    if (
      /from\s+['"]@tanstack\/vue-query['"]|\b(?:responseCache|entityCollections?|serverState|queryCache)\b/u.test(
        source,
      )
    ) {
      violations.push(
        `${normalizedFile}: Pinia stores may not own server entities, responses, or Vue Query state`,
      );
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredParts.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

async function verifyFixtures() {
  const fixtureRoot = path.join(repositoryRoot, 'scripts', 'fixtures', 'module-boundaries');
  const positive = await sourceFiles(path.join(fixtureRoot, 'positive'));
  const negative = await sourceFiles(path.join(fixtureRoot, 'negative'));
  const logicalPath = (file) => {
    if (file.endsWith('entity-shared-import.js'))
      return 'apps/web/src/entities/entity-shared-import.js';
    if (file.endsWith('entity-feature-import.js'))
      return 'apps/web/src/entities/entity-feature-import.js';
    if (file.endsWith('pinia-server-cache.js'))
      return 'apps/web/src/app/stores/pinia-server-cache.js';
    return `apps/web/src/features/fixtures/${path.basename(file)}`;
  };
  const positiveViolations = (
    await Promise.all(
      positive.map(async (file) =>
        violationsForSource(logicalPath(file), await readFile(file, 'utf8')),
      ),
    )
  ).flat();
  const negativeResults = await Promise.all(
    negative.map(async (file) =>
      violationsForSource(logicalPath(file), await readFile(file, 'utf8')),
    ),
  );
  if (positiveViolations.length)
    throw new Error(`Positive boundary fixture failed:\n${positiveViolations.join('\n')}`);
  if (negativeResults.some((result) => result.length === 0))
    throw new Error('A negative boundary fixture was not rejected.');
}

export async function verifyRepository() {
  await verifyFixtures();
  const files = (
    await Promise.all(sourceRoots.map(async (root) => sourceFiles(path.join(repositoryRoot, root))))
  ).flat();
  const violations = (
    await Promise.all(
      files.map(async (file) =>
        violationsForSource(
          normalize(path.relative(repositoryRoot, file)),
          await readFile(file, 'utf8'),
        ),
      ),
    )
  ).flat();
  if (violations.length) throw new Error(`Module boundary violations:\n${violations.join('\n')}`);
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await verifyRepository();
  process.stdout.write(
    `boundaries:check: verified ${count} source files and positive/negative fixtures.\n`,
  );
}
