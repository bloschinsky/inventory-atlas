import { createHmac } from 'node:crypto';

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Try again later.');
    this.name = 'RateLimitError';
  }
}

interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export class AuthRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  consume(scope: 'sign-in' | 'invitation', identity: string): void {
    const policy: RateLimitPolicy =
      scope === 'sign-in'
        ? { limit: 5, windowMs: 15 * 60_000 }
        : { limit: 10, windowMs: 15 * 60_000 };
    const key = createHmac('sha256', this.secret)
      .update(`rate-limit\0${scope}\0${identity}`)
      .digest('hex');
    const now = this.now();
    const recent = (this.attempts.get(key) ?? []).filter((at) => at > now - policy.windowMs);
    if (recent.length >= policy.limit) {
      throw new RateLimitError(
        Math.max(1, Math.ceil((recent[0]! + policy.windowMs - now) / 1_000)),
      );
    }
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) this.prune(now, policy.windowMs);
  }

  reset(scope: 'sign-in' | 'invitation', identity: string): void {
    const key = createHmac('sha256', this.secret)
      .update(`rate-limit\0${scope}\0${identity}`)
      .digest('hex');
    this.attempts.delete(key);
  }

  private prune(now: number, maximumWindowMs: number): void {
    for (const [key, values] of this.attempts) {
      if (!values.some((at) => at > now - maximumWindowMs)) this.attempts.delete(key);
    }
  }
}
