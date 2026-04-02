import type { Redis } from 'ioredis';
import { log } from './logger.js';

const AUTH_AUDIT_REDIS_KEY = 'auth:audit:events';

export type AuthAuditAction = 'login' | 'token_refresh' | 'logout';

export type AuthAuditEntry = {
  action: AuthAuditAction;
  timestamp: number;
  ip: string;
  userAgent: string;
  details: Record<string, unknown>;
};

export class AuthAuditLog {
  public constructor(
    private readonly redis: Redis,
    private readonly maxEntries: number,
    private readonly ttlSeconds: number
  ) {}

  public async append(action: AuthAuditAction, details: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const entry: AuthAuditEntry = {
      action,
      timestamp: now,
      ip: this.asString(details.ip),
      userAgent: this.asString(details.userAgent),
      details
    };

    try {
      await this.redis.lpush(AUTH_AUDIT_REDIS_KEY, JSON.stringify(entry));
      await this.redis.ltrim(AUTH_AUDIT_REDIS_KEY, 0, this.maxEntries - 1);
      await this.redis.expire(AUTH_AUDIT_REDIS_KEY, this.ttlSeconds);
    } catch (error) {
      log('warn', 'auth_audit_redis_write_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error',
        action,
        timestamp: now
      });
    }
  }

  public async listRecent(limit: number): Promise<AuthAuditEntry[]> {
    const boundedLimit = Math.max(1, Math.min(this.maxEntries, Math.floor(limit)));
    try {
      const rows = await this.redis.lrange(AUTH_AUDIT_REDIS_KEY, 0, boundedLimit - 1);
      const entries: AuthAuditEntry[] = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row) as Partial<AuthAuditEntry>;
          if (
            (parsed.action === 'login' ||
              parsed.action === 'token_refresh' ||
              parsed.action === 'logout') &&
            typeof parsed.timestamp === 'number' &&
            typeof parsed.ip === 'string' &&
            typeof parsed.userAgent === 'string' &&
            typeof parsed.details === 'object' &&
            parsed.details !== null
          ) {
            entries.push({
              action: parsed.action,
              timestamp: parsed.timestamp,
              ip: parsed.ip,
              userAgent: parsed.userAgent,
              details: parsed.details as Record<string, unknown>
            });
          }
        } catch {
          // Ignore malformed rows to avoid breaking diagnostics endpoint.
        }
      }
      return entries;
    } catch (error) {
      log('warn', 'auth_audit_redis_read_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error',
        timestamp: Date.now()
      });
      return [];
    }
  }

  private asString(value: unknown): string {
    return typeof value === 'string' && value.length > 0 ? value : 'unknown';
  }
}
