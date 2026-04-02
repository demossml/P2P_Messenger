import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  ALLOWED_ORIGIN: z.string().url(),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  REDIS_URL: z.string().url(),
  POSTGRES_URL: z.string().url(),
  TURN_SECRET: z.string().min(32),
  TURN_HOST: z.string().min(1).default('turn.yourdomain.com'),
  TURN_REALM: z.string().min(1).default('turn.yourdomain.com'),
  TURN_CREDENTIALS_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3600),
  ROOM_MAX_PEERS: z.coerce.number().int().min(2).max(64).default(8),
  ROOM_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(24 * 60 * 60),
  WS_RATE_LIMIT_PER_SECOND: z.coerce.number().int().min(1).max(200).default(10),
  AUTH_AUDIT_LOG_MAX_ENTRIES: z.coerce.number().int().min(100).max(100_000).default(5000),
  AUTH_AUDIT_LOG_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(365 * 24 * 60 * 60)
    .default(30 * 24 * 60 * 60)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Environment validation failed:\n${details}`);
}

export const env = parsed.data;
