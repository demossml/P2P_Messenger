import type { Redis } from 'ioredis';

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(state[1])
local lastMs = tonumber(state[2])

if tokens == nil then
  tokens = capacity
end

if lastMs == nil then
  lastMs = nowMs
end

if nowMs > lastMs then
  local elapsedMs = nowMs - lastMs
  tokens = math.min(capacity, tokens + (elapsedMs * refillPerMs))
end

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last', nowMs)
redis.call('EXPIRE', key, ttlSeconds)

return allowed
`;

export class ConnectionRateLimiter {
  private readonly bucketCapacity: number;
  private readonly refillPerMs: number;
  private readonly ttlSeconds: number;

  public constructor(
    private readonly redis: Redis,
    private readonly limitPerSecond: number
  ) {
    this.bucketCapacity = Math.max(1, limitPerSecond);
    this.refillPerMs = this.bucketCapacity / 1000;
    this.ttlSeconds = 120;
  }

  public async allow(connectionId: string): Promise<boolean> {
    const key = `rl:conn:${connectionId}`;
    const nowMs = Date.now();
    const allowed = await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      String(this.bucketCapacity),
      String(this.refillPerMs),
      String(nowMs),
      String(this.ttlSeconds)
    );

    return Number(allowed) === 1;
  }
}
