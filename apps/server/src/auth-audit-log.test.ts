import { describe, expect, it } from 'vitest';
import { AuthAuditLog } from './auth-audit-log.js';

class FakeRedis {
  private readonly lists = new Map<string, string[]>();
  private readonly ttl = new Map<string, number>();

  public async lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  public async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const list = this.lists.get(key) ?? [];
    const next = list.slice(start, stop + 1);
    this.lists.set(key, next);
    return 'OK';
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.ttl.set(key, seconds);
    return 1;
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop + 1);
  }

  public list(key: string): string[] {
    return this.lists.get(key) ?? [];
  }

  public ttlSeconds(key: string): number | undefined {
    return this.ttl.get(key);
  }
}

describe('AuthAuditLog', () => {
  it('stores auth audit entries in Redis list with cap and TTL', async () => {
    const redis = new FakeRedis();
    const auditLog = new AuthAuditLog(redis as never, 2, 3600);

    await auditLog.append('login', {
      result: 'success',
      ip: '127.0.0.1',
      userAgent: 'vitest'
    });
    await auditLog.append('token_refresh', {
      result: 'success',
      ip: '127.0.0.1',
      userAgent: 'vitest'
    });
    await auditLog.append('logout', {
      result: 'success',
      ip: '127.0.0.1',
      userAgent: 'vitest'
    });

    const rows = redis.list('auth:audit:events');
    expect(rows).toHaveLength(2);

    const newest = JSON.parse(rows[0] ?? '{}') as {
      action?: string;
      ip?: string;
      userAgent?: string;
    };
    const oldest = JSON.parse(rows[1] ?? '{}') as { action?: string };

    expect(newest.action).toBe('logout');
    expect(newest.ip).toBe('127.0.0.1');
    expect(newest.userAgent).toBe('vitest');
    expect(oldest.action).toBe('token_refresh');
    expect(redis.ttlSeconds('auth:audit:events')).toBe(3600);
  });

  it('returns latest valid entries and skips malformed rows', async () => {
    const redis = new FakeRedis();
    const auditLog = new AuthAuditLog(redis as never, 10, 3600);

    await auditLog.append('login', {
      result: 'success',
      ip: '10.0.0.1',
      userAgent: 'test-agent'
    });
    await redis.lpush('auth:audit:events', '{not-json');
    await redis.lpush(
      'auth:audit:events',
      JSON.stringify({
        action: 'logout',
        timestamp: Date.now(),
        ip: '10.0.0.2',
        userAgent: 'test-agent',
        details: { result: 'success' }
      })
    );

    const entries = await auditLog.listRecent(5);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.action).toBe('logout');
    expect(entries[1]?.action).toBe('login');
  });
});
