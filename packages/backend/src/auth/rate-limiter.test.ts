import { describe, expect, it } from 'vitest';
import { AuthRateLimiter, RateLimitError } from './rate-limiter.js';

describe('authentication rate limiter', () => {
  it('limits each hashed identity and resets successful attempts', () => {
    let now = 1_000;
    const limiter = new AuthRateLimiter('test-secret', () => now);
    for (let index = 0; index < 5; index += 1) limiter.consume('sign-in', 'ip|email');
    expect(() => limiter.consume('sign-in', 'ip|email')).toThrow(RateLimitError);
    limiter.reset('sign-in', 'ip|email');
    expect(() => limiter.consume('sign-in', 'ip|email')).not.toThrow();
    now += 16 * 60_000;
    expect(() => limiter.consume('sign-in', 'another')).not.toThrow();
  });
});
