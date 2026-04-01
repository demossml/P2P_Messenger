import { describe, expect, it, vi } from 'vitest';
import { ConnectionRateLimiter } from './rate-limiter.js';

type BucketState = {
  tokens: number;
  last: number;
};

class FakeRedis {
  private readonly buckets = new Map<string, BucketState>();
  private readonly expirySeconds = new Map<string, number>();

  public async eval(
    _script: string,
    _numKeys: number,
    key: string,
    capacityRaw: string,
    refillPerMsRaw: string,
    nowMsRaw: string,
    ttlSecondsRaw: string
  ): Promise<number> {
    const capacity = Number(capacityRaw);
    const refillPerMs = Number(refillPerMsRaw);
    const nowMs = Number(nowMsRaw);
    const ttlSeconds = Number(ttlSecondsRaw);

    const current = this.buckets.get(key);
    let tokens = current?.tokens ?? capacity;
    const lastMs = current?.last ?? nowMs;

    if (nowMs > lastMs) {
      tokens = Math.min(capacity, tokens + (nowMs - lastMs) * refillPerMs);
    }

    const allowed = tokens >= 1 ? 1 : 0;
    if (allowed === 1) {
      tokens -= 1;
    }

    this.buckets.set(key, {
      tokens,
      last: nowMs
    });
    this.expirySeconds.set(key, ttlSeconds);

    return allowed;
  }

  public getTokens(key: string): number | undefined {
    return this.buckets.get(key)?.tokens;
  }

  public getExpiry(key: string): number | undefined {
    return this.expirySeconds.get(key);
  }
}

describe('ConnectionRateLimiter', () => {
  it('allows events up to bucket capacity and blocks next immediate event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const redis = new FakeRedis();
    const limiter = new ConnectionRateLimiter(redis as never, 2);

    await expect(limiter.allow('conn-1')).resolves.toBe(true);
    await expect(limiter.allow('conn-1')).resolves.toBe(true);
    await expect(limiter.allow('conn-1')).resolves.toBe(false);

    vi.useRealTimers();
  });

  it('refills tokens over time for smoother rate limiting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const redis = new FakeRedis();
    const limiter = new ConnectionRateLimiter(redis as never, 2);

    await limiter.allow('conn-2');
    await limiter.allow('conn-2');
    await expect(limiter.allow('conn-2')).resolves.toBe(false);

    vi.advanceTimersByTime(500);
    await expect(limiter.allow('conn-2')).resolves.toBe(true);
    await expect(limiter.allow('conn-2')).resolves.toBe(false);

    vi.useRealTimers();
  });

  it('stores ttl for bucket keys to prevent stale growth', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const redis = new FakeRedis();
    const limiter = new ConnectionRateLimiter(redis as never, 5);

    await limiter.allow('conn-3');
    expect(redis.getExpiry('rl:conn:conn-3')).toBe(120);
    expect(redis.getTokens('rl:conn:conn-3')).toBeLessThan(5);

    vi.useRealTimers();
  });
});
