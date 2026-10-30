/** Stable error codes returned by the API. Messages are Arabic and safe to show to the user. */
export const ERROR_CODES = [
  'validation_failed',
  'bad_request',
  'phone_taken',
  /** A one-time code is wrong or has expired */
  'otp_invalid',
  /** Too many wrong attempts: ask for a new code */
  'locked',
  'invalid_credentials',
  'unauthorized',
  'forbidden',
  /** The device was revoked by the owner: it stops selling and syncing (17) */
  'device_revoked',
  'not_found',
  'method_not_allowed',
  /** The request repeats one that just happened (e.g. two tabs refreshing at once): retry */
  'conflict',
  /** 413: split the request (e.g. a sync batch) into smaller ones */
  'payload_too_large',
  'unsupported_media_type',
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
    /** Short reference shown to the user; the same id as the request in the server logs */
    ref?: string;
  };
}
