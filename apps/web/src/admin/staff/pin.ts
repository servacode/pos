import { toLatinDigits, type MeResponse, type Permission } from '@serva/core';

/**
 * The rules of the cashier sign-in code (16 › تخمين رمز PIN): anyone who approves other people's
 * operations (a discount over the limit, a refund, cash out of the drawer…) uses 6 digits; a
 * cashier may use 4. The server checks the same rules; this screen says them before sending.
 */
const APPROVING: readonly Permission[] = [
  'sale.discount_over_limit',
  'sale.refund',
  'sale.void',
  'drawer.open_no_sale',
  'cash.move',
  'shift.close_any',
];

export function needsSixDigits(me: MeResponse): boolean {
  return (
    me.user.roles.some((role) => role.key === 'owner' || role.key === 'manager') ||
    me.user.permissions.some((permission) => APPROVING.includes(permission))
  );
}

function isRun(digits: string, step: 1 | -1): boolean {
  for (let i = 1; i < digits.length; i += 1) {
    if (Number(digits[i]) - Number(digits[i - 1]) !== step) return false;
  }
  return true;
}

/** 0000, 1111…, 1234, 123456, 4321, 654321: the first codes anyone tries. */
export function isTrivialPin(digits: string): boolean {
  return /^(\d)\1*$/.test(digits) || isRun(digits, 1) || isRun(digits, -1);
}

/** Arabic digits typed on an Arabic keyboard become Latin; spaces go. */
export function pinDigits(input: string): string {
  return toLatinDigits(input).replace(/\s+/g, '');
}

/** Why a typed code cannot be used, or null. */
export function pinProblem(input: string, sixDigits: boolean): string | null {
  const digits = pinDigits(input);
  if (!digits) return 'اكتب رمز الدخول';
  if (!/^\d+$/.test(digits)) return 'رمز الدخول أرقام فقط';
  if (sixDigits && digits.length !== 6) return 'رمزك 6 أرقام لأنك توافق على عمليات غيرك';
  if (digits.length !== 4 && digits.length !== 6) return 'رمز الدخول 4 أرقام أو 6';
  if (isTrivialPin(digits)) return 'هذا الرمز سهل التخمين. اختر أرقاماً غير متتالية ولا مكررة';
  return null;
}
