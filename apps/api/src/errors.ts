import type { ApiErrorBody, ErrorCode } from '@serva/core';
import type { ZodError } from 'zod';

/** An error whose code and Arabic message are safe to send to the client. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toBody(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) },
    };
  }
}

export const unauthorized = () => new AppError(401, 'unauthorized', 'انتهت الجلسة. سجّل الدخول من جديد.');

/** Turns a zod error into per-field Arabic messages (first message per top-level field). */
export function validationError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_';
    fields[key] ??= issue.message;
  }
  return new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);
}

/** True when a database error is a unique-constraint violation on the given constraint/index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505' && pg.constraint_name === constraint) return true;
  }
  return false;
}
