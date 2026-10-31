import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { weakSecretReason } from './auth/tokens';
import { parseProxyTrust, type ProxyTrust } from './http/client-ip';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
/** Passwords from docker-compose.yml and scripts/db-bootstrap.sh, for local development only */
const DEV_DB_PASSWORDS = new Set(['', 'postgres', 'serva_app', 'serva_owner']);

function hasDefaultPassword(url: string): boolean {
  try {
    return DEV_DB_PASSWORDS.has(decodeURIComponent(new URL(url).password));
  } catch {
    return false;
  }
}

const perMinute = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Listen address. Loopback by default; a container sets 0.0.0.0 explicitly (with NODE_ENV=production). */
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** Signs access tokens (one key per gate is derived from it). Generate: openssl rand -base64 48 */
    JWT_SECRET: z.string(),
    /** Former JWT_SECRET values, comma-separated: still accepted for tokens issued before a rotation */
    JWT_PREVIOUS_SECRETS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      ),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** A sign-in session ends this many days after sign-in, however often it is refreshed */
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(90),
    /** How long a "session still live" answer is cached per server instance (0 = always ask) */
    AUTH_CHECK_CACHE_SECONDS: z.coerce.number().int().min(0).max(60).default(30),
    /** Requests per minute per client address, on every route */
    RATE_LIMIT_PER_MINUTE: perMinute(600),
    /** Requests per minute per client address on sign-in and sign-up */
    AUTH_RATE_LIMIT_PER_MINUTE: perMinute(10),
    /** Sign-in attempts per hour for one phone number, from any address */
    LOGIN_PHONE_LIMIT_PER_HOUR: perMinute(20),
    /** Sign-up codes per hour sent to one phone number */
    REGISTER_PHONE_LIMIT_PER_HOUR: perMinute(5),
    /**
     * How sign-up codes are delivered: "log" writes them to the server log (development only);
     * "none" turns sign-up off until an SMS/Telegram channel is connected. Default: log outside
     * production, none in production.
     */
    OTP_DELIVERY: z.enum(['log', 'none']).optional(),
    /** Requests per minute per signed-in session (17: 300 per token) */
    SESSION_RATE_LIMIT_PER_MINUTE: perMinute(300),
    /** Requests per minute per store, all its users and devices together */
    STORE_RATE_LIMIT_PER_MINUTE: perMinute(3000),
    /** Requests per minute per device on the sync routes */
    DEVICE_RATE_LIMIT_PER_MINUTE: perMinute(240),
    /** Push batches per minute per device (17 › الحدود: a separate limit for the push) */
    SYNC_PUSH_RATE_LIMIT_PER_MINUTE: perMinute(60),
    /** Device activations with a QR or a typed code, per minute per client address */
    ACTIVATE_RATE_LIMIT_PER_MINUTE: perMinute(10),
    /** Activations with a typed code, per hour per store code (from any address) */
    ACTIVATE_STORE_LIMIT_PER_HOUR: perMinute(30),
    /** Where bootstrap snapshot files are kept; a temporary folder by default */
    SNAPSHOT_DIR: z.string().min(1).default(join(tmpdir(), 'serva-snapshots')),
    /** How long a snapshot file can be downloaded; a new device reuses one for half that time */
    SNAPSHOT_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    /**
     * Web address the pairing QR opens (<origin>/link#…), e.g. https://app.serva.sy. By default
     * the address the owner's request came to.
     */
    PUBLIC_WEB_ORIGIN: z
      .url()
      .optional()
      .transform((v) => (v ? new URL(v).origin : undefined)),
    /**
     * Proxies in front of the server that may report the client address in X-Forwarded-For:
     * "false" (none, default) or their addresses/CIDR ranges, comma-separated. Never "true".
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value, ctx): ProxyTrust => {
        const parsed = parseProxyTrust(value);
        if (typeof parsed === 'string') {
          ctx.addIssue({ code: 'custom', message: parsed });
          return z.NEVER;
        }
        return parsed;
      }),
    /**
     * Header carrying the client address set by the edge, e.g. cf-connecting-ip when the origin
     * only accepts Cloudflare. Believed only from proxies listed in TRUST_PROXY.
     */
    CLIENT_IP_HEADER: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((v) => v || undefined),
    /** Password hashes computed at once (each takes 19 MiB and a libuv thread) */
    PASSWORD_HASH_CONCURRENCY: z.coerce.number().int().positive().default(2),
    /** Password checks allowed to wait; beyond this, sign-in answers 503 at once */
    PASSWORD_HASH_QUEUE: z.coerce.number().int().min(0).default(32),
    /**
     * Secure flag on the refresh cookie. On by default (browsers accept it on http://localhost);
     * "false" is allowed only outside production, for browsers that refuse it on localhost.
     */
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === 'production';
    if (env.NODE_ENV === 'development' && !LOOPBACK.has(env.HOST)) {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: `NODE_ENV is "development" (the default) but HOST is ${env.HOST}. Set NODE_ENV=production on a server, or listen on 127.0.0.1 for local development.`,
      });
    }
    if (production && env.OTP_DELIVERY === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DELIVERY'],
        message: 'OTP_DELIVERY=log writes codes to the log; not allowed in production',
      });
    }
    if (production && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE=false is not allowed in production',
      });
    }
    if (production && hasDefaultPassword(env.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL uses a development default password; set a real one in production',
      });
    }
    const weak = weakSecretReason(env.JWT_SECRET, production);
    if (weak) ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: `JWT_SECRET ${weak}` });
    for (const old of env.JWT_PREVIOUS_SECRETS) {
      if (old.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_PREVIOUS_SECRETS'],
          message: 'each previous secret must be at least 32 characters',
        });
      }
    }
    if (env.CLIENT_IP_HEADER && env.TRUST_PROXY.kind !== 'list') {
      ctx.addIssue({
        code: 'custom',
        path: ['CLIENT_IP_HEADER'],
        message: 'CLIENT_IP_HEADER needs TRUST_PROXY to list the proxy addresses allowed to set it',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
