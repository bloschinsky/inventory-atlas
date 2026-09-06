import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSource, zItemMutationRequestDto } from './index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('contract workspace', () => {
  it('declares normalized OpenAPI as its generation source', () => {
    expect(contractSource).toBe('normalized-openapi');
  });

  it('rejects an invalid generated-client mutation payload at runtime', () => {
    const result = zItemMutationRequestDto.safeParse({
      displayName: '',
      expectedVersion: '7',
    });
    expect(result.success).toBe(false);
  });

  it('carries the normalized spec checksum in every generated artifact', async () => {
    const spec = JSON.parse(
      await readFile(path.resolve(packageRoot, '..', '..', 'docs', 'api', 'openapi.json'), 'utf8'),
    );
    const files = await readdir(path.join(packageRoot, 'src', 'generated'), { recursive: true });
    const artifacts = files.filter((file) => /\.([cm]?js|ts)$/u.test(file));
    expect(artifacts.length).toBeGreaterThan(3);
    for (const file of artifacts) {
      expect(await readFile(path.join(packageRoot, 'src', 'generated', file), 'utf8')).toContain(
        `OpenAPI-SHA256: ${spec['x-spec-checksum']}`,
      );
    }
  });
});
