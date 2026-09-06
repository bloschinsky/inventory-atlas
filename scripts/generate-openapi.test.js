import { describe, expect, it } from 'vitest';
import { checksumForOpenApi, normalizeOpenApi } from './generate-openapi.mjs';

describe('OpenAPI normalization', () => {
  it('produces identical output and checksums for equivalent object and set ordering', () => {
    const left = {
      components: { schemas: { Sample: { required: ['z', 'a'], type: 'object' } } },
      openapi: '3.0.0',
    };
    const right = {
      openapi: '3.0.0',
      components: { schemas: { Sample: { type: 'object', required: ['a', 'z'] } } },
    };
    expect(normalizeOpenApi(left)).toEqual(normalizeOpenApi(right));
    expect(checksumForOpenApi(left)).toBe(checksumForOpenApi(right));
  });

  it('excludes an embedded checksum from the source checksum', () => {
    const document = { openapi: '3.0.0' };
    expect(checksumForOpenApi({ ...document, 'x-spec-checksum': 'stale' })).toBe(
      checksumForOpenApi(document),
    );
  });
});
