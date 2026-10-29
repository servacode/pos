import { ApiError } from './api';

export type FieldErrors = Partial<Record<string, string>>;

export interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function rootKey(path: string): string {
  return path.split('.')[0] ?? path;
}

export function issuesToFieldErrors(issues: readonly Issue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (key === undefined) continue;
    const name = String(key);
    errors[name] ??= issue.message;
  }
  return errors;
}

export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || !error.fields) return {};
  const errors: FieldErrors = {};
  for (const [path, message] of Object.entries(error.fields)) {
    errors[rootKey(path)] ??= message;
  }
  return errors;
}

export function focusFirstError(form: HTMLFormElement | null, order: readonly string[], errors: FieldErrors) {
  const first = order.find((name) => errors[name]);
  if (!form || !first) return;
  form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
}
