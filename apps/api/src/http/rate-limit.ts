import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { Database } from '@serva/db';
import type { Clock } from '../clock';
import { AppError } from '../errors';

export const RATE_LIMITED_MESSAGE = 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.';

interface Hit {
  key: string;
  count: number;
  resetAt: Date;
}

/** Counts one hit on each key in the shared Postgres counters (fixed window). */
export async function hitCounters(db: Database, keys: string[], windowMs: number, now: Date): Promise<Hit[]> {
  const unique = [...new Set(keys)];
  const rows = await db.execute<{ key: string; count: number; reset_at: string }>(
    sql`select * from rate_limit_hit(array[${sql.join(
      unique.map((k) => sql`${k}`),
      sql`, `,
    )}]::text[], ${Math.round(windowMs)}, ${now.toISOString()}::timestamptz)`,
  );
  return rows.map((r) => ({ key: r.key, count: Number(r.count), resetAt: new Date(r.reset_at) }));
}

/**
 * Applies limits that share one window, e.g. per phone number or per session. Throws 429 with
 * Retry-After when any key is over its maximum.
 */
export async function enforceLimits(
  request: FastifyRequest,
  reply: FastifyReply,
  windowMs: number,
  limits: { key: string; max: number }[],
): Promise<void> {
  const { db, clock } = request.server;
  const now = clock.now();
  const hits = await hitCounters(
    db,
    limits.map((l) => l.key),
    windowMs,
    now,
  );
  for (const limit of limits) {
    const hit = hits.find((h) => h.key === limit.key);
    if (hit && hit.count > limit.max) {
      reply.header('retry-after', Math.max(1, Math.ceil((hit.resetAt.getTime() - now.getTime()) / 1000)));
      throw new AppError(429, 'rate_limited', RATE_LIMITED_MESSAGE);
    }
  }
}

/**
 * Store for @fastify/rate-limit backed by the shared Postgres counters, so per-address limits
 * hold across restarts and server instances instead of living in one process's memory.
 */
export function postgresRateLimitStore(db: Database, clock: Clock): FastifyRateLimitStoreCtor {
  class PostgresRateLimitStore implements FastifyRateLimitStore {
    constructor(
      private readonly options: { timeWindow?: unknown },
      private readonly prefix = 'ip:',
    ) {}

    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    ): void {
      const windowMs = typeof this.options.timeWindow === 'number' ? this.options.timeWindow : 60_000;
      const now = clock.now();
      hitCounters(db, [this.prefix + key], windowMs, now).then(
        ([hit]) =>
          callback(null, { current: hit!.count, ttl: Math.max(0, hit!.resetAt.getTime() - now.getTime()) }),
        (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    }

    child(routeOptions: Parameters<FastifyRateLimitStore['child']>[0]): FastifyRateLimitStore {
      // At runtime these are the merged limit options of the route, including its window.
      const merged = routeOptions as unknown as {
        timeWindow?: unknown;
        routeInfo?: { method?: string; url?: string };
      };
      const route = merged.routeInfo;
      return new PostgresRateLimitStore(merged, `ip:${route?.method ?? ''}${route?.url ?? ''}:`);
    }
  }
  return PostgresRateLimitStore as unknown as FastifyRateLimitStoreCtor;
}
