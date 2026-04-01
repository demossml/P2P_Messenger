import type { Redis } from 'ioredis';

export class ConnectionRateLimiter {
  public constructor(
    private readonly redis: Redis,
    private readonly limitPerSecond: number
  ) {}

  public async allow(connectionId: string): Promise<boolean> {
    const key = `rl:conn:${connectionId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, 1);
    }

    return count <= this.limitPerSecond;
  }
}
