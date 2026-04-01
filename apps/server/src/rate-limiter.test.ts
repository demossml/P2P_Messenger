import { describe, expect, it } from 'vitest';
import { ConnectionRateLimiter } from './rate-limiter.js';

class FakeRedis {
  private readonly counters = new Map<string, number>();
  private readonly expirySeconds = new Map<string, number>();

  public async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expirySeconds.set(key, seconds);
    return 1;
  }

  public getExpiry(key: string): number | undefined {
    return this.expirySeconds.get(key);
  }
}

describe('ConnectionRateLimiter', () => {
  it('allows events up to per-second limit and blocks the next one', async () => {
    const redis = new FakeRedis();
    const limiter = new ConnectionRateLimiter(redis as never, 2);

    await expect(limiter.allow('conn-1')).resolves.toBe(true);
    await expect(limiter.allow('conn-1')).resolves.toBe(true);
    await expect(limiter.allow('conn-1')).resolves.toBe(false);
  });

  it('sets one-second expiry only on first increment of a key', async () => {
    const redis = new FakeRedis();
    const limiter = new ConnectionRateLimiter(redis as never, 5);

    await limiter.allow('conn-2');
    expect(redis.getExpiry('rl:conn:conn-2')).toBe(1);

    await limiter.allow('conn-2');
    expect(redis.getExpiry('rl:conn:conn-2')).toBe(1);
  });
});
