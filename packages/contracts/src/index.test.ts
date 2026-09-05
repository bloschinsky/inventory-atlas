import { describe, expect, it } from 'vitest';
import { contractSource } from './index.js';

describe('contract workspace', () => {
  it('declares its pending generation source', () => {
    expect(contractSource).toBe('openapi-pending');
  });
});
