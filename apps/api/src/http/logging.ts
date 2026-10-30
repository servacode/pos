import { randomBytes } from 'node:crypto';
import type { FastifyServerOptions } from 'fastify';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

/**
 * Log fields that must never be written: credentials, tokens and hashes. Error objects go through
 * serializeError, which keeps only whitelisted fields. Reuse both for any error reporter added
 * later (a Sentry/GlitchTip beforeSend must apply serializeError the same way).
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'password_hash',
  'pinHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'token_hash',
  'code',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.pinHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.token_hash',
];

interface DatabaseErrorFields {
  code?: unknown;
  constraint_name?: unknown;
  table_name?: unknown;
  column_name?: unknown;
  severity?: unknown;
}

/** Quoted values in database messages (e.g. invalid input syntax for type uuid: "...") */
const scrubValues = (message: string) => message.replace(/"[^"]*"/g, '"…"');

/**
 * An error as safe log fields: type, message, SQLSTATE code, constraint and table, stack, cause.
 * Drops what can carry personal data or secrets: query text and parameters (drizzle puts them in
 * the message), Postgres `detail` (e.g. "Key (phone)=(+963…) already exists"), and quoted values.
 */
export function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: '[non-error value]' };
  const db = error as Error & DatabaseErrorFields;
  const isQueryError = 'params' in error || error.message.startsWith('Failed query:');
  const message = isQueryError
    ? 'Failed query (statement and parameters withheld)'
    : scrubValues(error.message);
  // The stack starts with the original (possibly multi-line) message: keep only the frames.
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  const stack = [`${error.name}: ${message}`, ...frames].join('\n');
  const out: Record<string, unknown> = { type: error.name, message };
  if (typeof db.code === 'string') out.code = db.code;
  if (typeof db.severity === 'string') out.severity = db.severity;
  if (typeof db.constraint_name === 'string') out.constraint = db.constraint_name;
  if (typeof db.table_name === 'string') out.table = db.table_name;
  if (typeof db.column_name === 'string') out.column = db.column_name;
  out.stack = stack;
  if (error.cause !== undefined && depth < 3) out.cause = serializeError(error.cause, depth + 1);
  return out;
}

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

/** Short request id, shown to users as the error reference (`ref`) and written in every log line. */
export function newRequestRef(): string {
  const bytes = randomBytes(10);
  let ref = '';
  for (const b of bytes) ref += REF_ALPHABET[b % 32];
  return ref;
}

export function loggerOptions(level: string, stream?: NodeJS.WritableStream): FastifyServerOptions['logger'] {
  if (level === 'silent') return false;
  return {
    level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: { err: serializeError, error: serializeError } as unknown as LoggerOptions['serializers'],
    ...(stream ? { stream } : {}),
  };
}
