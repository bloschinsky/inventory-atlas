import * as argon2 from 'argon2';
import { beforeAll, describe, expect, it } from 'vitest';
import { PasswordHasher } from './index.js';

const hasher = new PasswordHasher();
const password = '  Synthetic пароль 🔐 e\u0301  ';
let encoded: string;

describe('Auth Argon2id credentials', () => {
  beforeAll(async () => {
    encoded = await hasher.hash(password);
  });

  it('encodes the algorithm, version, work factors, random salt and digest', () => {
    const parts = encoded.split('$');
    expect(parts.slice(0, 3)).toEqual(['', 'argon2id', 'v=19']);
    expect(parts[3]!.split(',').sort()).toEqual(['m=65536', 'p=4', 't=3']);
    expect(Buffer.from(parts[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(32);
    expect(encoded).not.toContain(password);
  });

  it('uses a fresh salt for each hash of the same password', async () => {
    const second = await hasher.hash(password);
    expect(second.split('$')[4]).not.toBe(encoded.split('$')[4]);
    expect(await hasher.verify(second, password)).toBe(true);
    expect(await hasher.verify(encoded, password)).toBe(true);
  });

  it('rejects wrong passwords without trimming or normalizing input', async () => {
    for (const incorrect of ['wrong password', password.trim(), password.normalize('NFC')]) {
      expect(await hasher.verify(encoded, incorrect)).toBe(false);
    }
  });

  it('does not truncate long passwords or embedded null characters', async () => {
    const longPassword = `${'a'.repeat(128)}\0пароль`;
    const digest = await hasher.hash(longPassword);
    expect(await hasher.verify(digest, longPassword)).toBe(true);
    expect(await hasher.verify(digest, 'a'.repeat(128))).toBe(false);
    expect(await hasher.verify(digest, `${longPassword}!`)).toBe(false);
  });

  it('verifies previously encoded work factors independently of creation defaults', async () => {
    const older = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(await hasher.verify(older, password)).toBe(true);
    expect(await hasher.verify(older, 'wrong password')).toBe(false);
  });

  it('fails closed for malformed hashes and unsupported algorithms', async () => {
    for (const malformed of [
      '',
      'plaintext',
      '$argon2id$synthetic-schema-fixture',
      '$argon2id$v=19$m=65536,t=3,p=4$invalid$invalid',
      encoded.replace('$argon2id$', '$argon2i$'),
      encoded.replace('$argon2id$', '$argon2d$'),
    ]) {
      expect(await hasher.verify(malformed, password)).toBe(false);
    }
  });
});
