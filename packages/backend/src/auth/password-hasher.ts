import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

// RFC 9106's second recommended profile for memory-constrained deployments.
const options = Object.freeze({
  type: argon2.argon2id,
  version: 0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
});

/** Auth's credential adapter. Callers must never log passwords or encoded hashes. */
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    try {
      return await argon2.hash(password, { ...options, salt: randomBytes(16) });
    } catch {
      // Vendor errors must not propagate credential material to exception logs.
      throw new Error('Password hashing failed.');
    }
  }

  async verify(encodedHash: string, password: string): Promise<boolean> {
    if (!encodedHash.startsWith('$argon2id$')) return false;
    try {
      // Verification uses the stored parameters, including older work factors.
      return await argon2.verify(encodedHash, password);
    } catch {
      // Corrupt/unsupported stored credentials fail closed without exposing them.
      return false;
    }
  }
}
