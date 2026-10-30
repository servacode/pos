import { z } from 'zod';
import { parseProxyTrust, type ProxyTrust } from './http/client-ip';

const perMinute = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
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
    /** Requests per minute per signed-in session (17: 300 per token) */
    SESSION_RATE_LIMIT_PER_MINUTE: perMinute(300),
    /** Requests per minute per store, all its users and devices together */
    STORE_RATE_LIMIT_PER_MINUTE: perMinute(3000),
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
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
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
