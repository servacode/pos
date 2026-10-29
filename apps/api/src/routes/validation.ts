import type { ZodType } from 'zod';
import { validationError } from '../errors';

export function parseBody<T extends ZodType>(schema: T, body: unknown) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}
