import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { serializeError } from './logging';

/**
 * Optional error reporting in the Sentry protocol (Sentry, or a self-hosted GlitchTip), enabled
 * only when SENTRY_DSN is set. It is a small client of its own instead of the Sentry SDK on
 * purpose: the SDK collects request bodies, headers, cookies, user and breadcrumbs by default and
 * patches Node internals, while this one can send nothing but what is built here:
 *   error type, scrubbed message, stack frames, SQLSTATE/constraint/table (from serializeError),
 *   the route PATTERN (never the URL, query or body), the method, the status and the request ref.
 * Every error goes through serializeError first, so SQL text, parameters and database `detail`
 * never reach the event; scrubText() then masks what could still hide in a message (phone numbers,
 * e-mail addresses, tokens, anything that looks like SQL).
 */

export interface ReportContext {
  /** The request id users see as `ref` */
  ref?: string | undefined;
  /** Route pattern, e.g. /v1/stores/:id (not the real URL) */
  route?: string | undefined;
  method?: string | undefined;
  status?: number | undefined;
}

export interface ErrorReporter {
  /** Fire and forget: never throws, never delays the response. */
  captureException(error: unknown, context?: ReportContext): void;
  /** Waits for events in flight (shutdown). */
  flush(timeoutMs?: number): Promise<void>;
}

export const noopReporter: ErrorReporter = {
  captureException() {},
  async flush() {},
};

const SQL_LIKE =
  /\b(select|insert\s+into|update|delete\s+from|alter\s+table|drop\s+table)\b[\s\S]{0,400}?\b(from|into|set|values|where|table)\b/i;

/** Masks what a message could carry besides code: SQL, e-mail, phone numbers, tokens, long secrets. */
export function scrubText(text: string): string {
  if (SQL_LIKE.test(text)) return '[sql withheld]';
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [token]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[secret]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .slice(0, 500);
}

interface Frame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** "    at fn (file:line:col)" lines as Sentry frames (oldest call first). */
function framesOf(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const match = /^\s+at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = match[2]!.replace(/^file:\/\//, '');
    frames.push({
      filename,
      ...(match[1] ? { function: match[1] } : {}),
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.reverse();
}

interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: { frames: Frame[] };
}

/** serializeError's output (with its `cause` chain) as Sentry exception values, oldest first. */
function exceptionValues(error: unknown): ExceptionValue[] {
  const values: ExceptionValue[] = [];
  let current: Record<string, unknown> | undefined = serializeError(error);
  while (current) {
    const parts = [current.code, current.constraint, current.table].filter(
      (p): p is string => typeof p === 'string',
    );
    const message = scrubText(String(current.message ?? ''));
    values.push({
      type: String(current.type ?? 'Error'),
      value: parts.length > 0 ? `${message} [${parts.join(' ')}]` : message,
      ...(typeof current.stack === 'string' ? { stacktrace: { frames: framesOf(current.stack) } } : {}),
    });
    current = current.cause as Record<string, unknown> | undefined;
  }
  return values.reverse();
}

export interface ReporterOptions {
  dsn: string;
  environment?: string | undefined;
  release?: string | undefined;
}

/** The event for one error; exported so tests can check exactly what would leave the server. */
export function buildEvent(
  error: unknown,
  context: ReportContext,
  options: Pick<ReporterOptions, 'environment' | 'release'>,
  now: Date = new Date(),
): Record<string, unknown> {
  const tags: Record<string, string> = {};
  if (context.ref) tags.ref = context.ref.slice(0, 32);
  if (context.status !== undefined) tags.status = String(context.status);
  if (context.route) tags.route = context.route.slice(0, 200);
  return {
    event_id: randomBytes(16).toString('hex'),
    timestamp: now.getTime() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'serva-api',
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.release ? { release: options.release } : {}),
    exception: { values: exceptionValues(error) },
    tags,
    ...(context.route
      ? { request: { method: context.method ?? 'GET', url: context.route.slice(0, 200) } }
      : {}),
  };
}

/** At most this many reports per minute, so a failing dependency cannot flood the tracker. */
const MAX_PER_MINUTE = 30;
const SEND_TIMEOUT_MS = 5_000;

export function createReporter(
  options: ReporterOptions,
  log: FastifyBaseLogger,
  send: typeof fetch = fetch,
  clock: () => number = Date.now,
): ErrorReporter {
  const dsn = new URL(options.dsn);
  const publicKey = decodeURIComponent(dsn.username);
  const segments = dsn.pathname.split('/').filter((s) => s !== '');
  const projectId = segments.pop();
  if (!publicKey || !projectId) throw new Error('SENTRY_DSN needs a public key and a project id');
  const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
  const endpoint = `${dsn.protocol}//${dsn.host}${prefix}/api/${projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_client=serva-api/1, sentry_key=${publicKey}`;

  const inFlight = new Set<Promise<void>>();
  let windowStart = 0;
  let sent = 0;

  return {
    captureException(error, context = {}) {
      try {
        const now = clock();
        if (now - windowStart >= 60_000) {
          windowStart = now;
          sent = 0;
        }
        if (++sent > MAX_PER_MINUTE) return;
        const event = buildEvent(error, context, options, new Date(now));
        const body = [
          JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString() }),
          JSON.stringify({ type: 'event' }),
          JSON.stringify(event),
        ].join('\n');
        const request = send(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': auth },
          body,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        }).then(
          (res) => {
            if (!res.ok) log.warn({ status: res.status }, 'error report refused');
          },
          (failure: unknown) => {
            log.warn({ err: (failure as Error | undefined)?.name }, 'error report not delivered');
          },
        );
        inFlight.add(request);
        void request.finally(() => inFlight.delete(request));
      } catch {
        // Reporting must never break a request.
      }
    },
    async flush(timeoutMs = SEND_TIMEOUT_MS) {
      if (inFlight.size === 0) return;
      await Promise.race([
        Promise.allSettled([...inFlight]),
        new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
      ]);
    },
  };
}
