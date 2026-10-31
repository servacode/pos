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
  /** 401: the PIN «رمز الدخول» typed on a device is wrong, or the user cannot sign in there */
  'pin_invalid',
  'unauthorized',
  'forbidden',
  /** The device was revoked by the owner: it stops selling and syncing (17) */
  'device_revoked',
  'not_found',
  'method_not_allowed',
  /** 409: the record changed since it was read (`version`); reload it before saving (17 › التعديل المتزامن) */
  'stale_version',
  /** The request repeats one that just happened (e.g. two tabs refreshing at once): retry */
  'conflict',
  /** 413: split the request (e.g. a sync batch) into smaller ones */
  'payload_too_large',
  'unsupported_media_type',
  /**
   * 403: the trial or subscription has ended, or the platform suspended the store: reading and
   * exporting work, selling and editing stop until the owner pays (07; contracts/billing.ts)
   */
  'read_only',
  /** 409: this payment transaction number was already reported, by this store or another (17) */
  'duplicate_transaction',
  /**
   * 202 on a platform route: a sensitive change waits for a second team member, or runs by itself
   * after 24 hours (13 › موافقة شخص ثانٍ; contracts/platform.ts)
   */
  'awaiting_second_approval',
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
    /** With `locked`: seconds until another try is allowed */
    retryAfter?: number;
  };
}
