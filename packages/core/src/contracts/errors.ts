/** Stable error codes returned by the API. Messages are Arabic and safe to show to the user. */
export const ERROR_CODES = [
  'validation_failed',
  'phone_taken',
  'invalid_credentials',
  'unauthorized',
  'forbidden',
  'not_found',
  /** The request repeats one that just happened (e.g. two tabs refreshing at once): retry */
  'conflict',
  'rate_limited',
  /** The server is too busy to take this request now (503): retry shortly */
  'unavailable',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Field name → Arabic message, for form validation errors */
    fields?: Record<string, string>;
  };
}
