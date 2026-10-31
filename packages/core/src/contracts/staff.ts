import { z } from 'zod';
import type { Permission } from '../permissions';
import { latinDigits, uuidSchema } from './common';

/**
 * Signing in on a cashier device with a PIN «رمز الدخول» (16 › تخمين رمز PIN; 17 › السحب: users;
 * docs/contracts/step4.md, question Q1).
 *
 *   PUT  /v1/me/pin                  signed-in user (Bearer)       setPinInput → 204
 *   POST /v1/device/staff-sessions   device (Authorization: Device) staffSessionInput → StaffSessionResponse
 *
 * The server keeps only a slow hash of the PIN; no PIN data ever reaches a device in a pull set,
 * only `pinLength` and `pinVersion`. After a successful online sign-in the device keeps
 * HMAC(its non-extractable key, userId:pinVersion:pin) and checks offline sign-ins against it.
 *
 * Owners, managers and anyone who approves («رمز المدير») use 6 digits; a cashier may use 4.
 * After 5 wrong PINs for one user on one device, the device is locked for that user for a minute,
 * doubling with every failure after that (kept on the server; counted locally offline).
 *
 * Errors: wrong PIN, unknown user, no PIN set: 401 `pin_invalid`; locked out: 429 `locked` with
 * `retryAfter` (seconds) in the error body.
 */

/** The PIN lengths a keypad offers. */
export const PIN_LENGTHS = [4, 6] as const;
export type PinLength = (typeof PIN_LENGTHS)[number];

/** Wrong PINs allowed before the lockout starts. */
export const PIN_MAX_ATTEMPTS = 5;
/** The first lockout, in seconds; each failure after it doubles it. */
export const PIN_LOCK_SECONDS = 60;
/** The longest lockout, in seconds (a day). */
export const PIN_LOCK_MAX_SECONDS = 86_400;

/**
 * Seconds a user stays locked out after `failures` wrong PINs in a row: none for the first four,
 * 60 at the fifth, then 120, 240… up to a day.
 */
export function pinLockSeconds(failures: number): number {
  if (failures < PIN_MAX_ATTEMPTS) return 0;
  const doublings = failures - PIN_MAX_ATTEMPTS;
  if (doublings >= 20) return PIN_LOCK_MAX_SECONDS;
  return Math.min(PIN_LOCK_SECONDS * 2 ** doublings, PIN_LOCK_MAX_SECONDS);
}

/**
 * Permissions that make someone an approver (11 › ما يحتاج موافقة): their code allows what a
 * cashier may not do alone, so it has 6 digits like the owner's and the manager's.
 */
export const APPROVER_PERMISSIONS: readonly Permission[] = [
  'sale.discount_over_limit',
  'sale.refund',
  'sale.void',
  'drawer.open_no_sale',
  'cash.move',
  'shift.close_any',
  'users.manage',
];

/** 6 for owners, managers and approvers; 4 is allowed for everyone else. */
export function requiredPinLength(roleKeys: readonly string[], permissions: readonly string[]): PinLength {
  if (roleKeys.some((key) => key === 'owner' || key === 'manager')) return 6;
  return permissions.some((p) => (APPROVER_PERMISSIONS as readonly string[]).includes(p)) ? 6 : 4;
}

/** 1234, 4321, 0000, 123456, 987654…: every digit the same, or a run up or down by one. */
export function isTrivialPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]!));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]!);
}

/** A PIN as typed: Arabic digits are read as Latin; 4 or 6 digits. */
const pinSchema = z
  .string('رمز الدخول مطلوب')
  .transform(latinDigits)
  .pipe(z.string().regex(/^(\d{4}|\d{6})$/, 'رمز الدخول 4 أو 6 أرقام'));

/**
 * PUT /v1/me/pin: sets my PIN, confirmed with my password. The server also refuses 4 digits for an
 * owner, a manager or an approver (validation_failed on `pin`) and a wrong password
 * (validation_failed on `password`). The answer is 204; `pinVersion` moves up.
 */
export const setPinInput = z.object({
  pin: pinSchema.refine((pin) => !isTrivialPin(pin), 'هذا الرمز سهل التخمين. اختر رمزاً آخر'),
  password: z.string('كلمة السر مطلوبة').min(1, 'كلمة السر مطلوبة').max(200),
});
export type SetPinInput = z.input<typeof setPinInput>;
export type SetPinData = z.output<typeof setPinInput>;

/** POST /v1/device/staff-sessions: the user picked from the `users` pull set and the PIN typed. */
export const staffSessionInput = z.object({
  userId: uuidSchema,
  pin: pinSchema,
});
export type StaffSessionInput = z.input<typeof staffSessionInput>;
export type StaffSessionData = z.output<typeof staffSessionInput>;

/**
 * A signed-in staff member on this device. `roles` and `permissions` are those that apply in the
 * device's branch (roles given for every branch, or for this one).
 */
export interface StaffSessionResponse {
  userId: string;
  fullName: string;
  roles: { key: string; name: string; branchId: string | null }[];
  permissions: Permission[];
  pinVersion: number;
  pinLength: PinLength;
}
