import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
let fixture;
const writeJson = (file, value) => writeFile(file, JSON.stringify(value));

describe('installed dependency license gates', () => {
  beforeEach(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), 'atlas-license-'));
    for (const directory of ['scripts', 'apps', 'packages', 'node_modules/elkjs']) {
      await mkdir(path.join(fixture, directory), { recursive: true });
    }
    for (const file of [
      'check-licenses.mjs',
      'license-policy.mjs',
      'check-runtime-dependencies.mjs',
    ]) {
      await copyFile(new URL(file, import.meta.url), path.join(fixture, 'scripts', file));
    }
    await writeJson(path.join(fixture, 'package.json'), {
      name: 'synthetic-workspace',
      private: true,
      devDependencies: { elkjs: '0.11.1' },
    });
    await writeJson(path.join(fixture, 'node_modules/elkjs/package.json'), {
      name: 'elkjs',
      version: '0.11.1',
      license: 'EPL-2.0',
    });
  });
  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  const run = (file) => exec(process.execPath, [path.join(fixture, 'scripts', file)]);

  it('accepts the reviewed development dependency but rejects a transitive runtime edge', async () => {
    await expect(run('check-licenses.mjs')).resolves.toMatchObject({ stderr: '' });
    await mkdir(path.join(fixture, 'node_modules/runtime-adapter'));
    await writeJson(path.join(fixture, 'node_modules/runtime-adapter/package.json'), {
      name: 'runtime-adapter',
      version: '1.0.0',
      license: 'MIT',
      dependencies: { elkjs: '0.11.1' },
    });
    await writeJson(path.join(fixture, 'package.json'), {
      name: 'synthetic-workspace',
      private: true,
      dependencies: { 'runtime-adapter': '1.0.0' },
    });
    await expect(run('check-licenses.mjs')).rejects.toThrow(/approved only for development/);
  });
  it('rejects installed dependencies with missing licenses', async () => {
    await writeJson(path.join(fixture, 'node_modules/elkjs/package.json'), {
      name: 'elkjs',
      version: '0.11.1',
    });
    await expect(run('check-licenses.mjs')).rejects.toThrow(/Unapproved dependency licenses/);
  });
  it('rejects development files physically present in a production image even without a dependency edge', async () => {
    await expect(run('check-runtime-dependencies.mjs')).rejects.toThrow(
      /Development package elkjs/,
    );
  });
});
