import { describe, expect, it } from 'vitest';
import type { MeResponse, Permission } from '@serva/core';
import { makeMe } from '../../test/fixtures';
import { isTrivialPin, needsSixDigits, pinProblem } from './pin';

function me(roleKey: string, permissions: Permission[]): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, roles: [{ key: roleKey, name: roleKey, branchId: null }], permissions },
  };
}

describe('who needs 6 digits (16)', () => {
  it('owners, managers and anyone who approves', () => {
    expect(needsSixDigits(me('owner', []))).toBe(true);
    expect(needsSixDigits(me('manager', []))).toBe(true);
    expect(needsSixDigits(me('supervisor', ['sale.create', 'sale.discount_over_limit']))).toBe(true);
    expect(needsSixDigits(me('cashier', ['sale.create', 'sale.discount', 'shift.close_own']))).toBe(false);
  });
});

describe('the code rules', () => {
  it.each(['0000', '1111', '1234', '4321', '123456', '654321', '999999', '٠٠٠٠'])('refuses %s', (pin) => {
    expect(pinProblem(pin, false)).toBe('هذا الرمز سهل التخمين. اختر أرقاماً غير متتالية ولا مكررة');
  });

  it('accepts 4 or 6 digits from a cashier, Arabic digits included', () => {
    expect(pinProblem('2580', false)).toBeNull();
    expect(pinProblem('٢٥٨٠', false)).toBeNull();
    expect(pinProblem('258013', false)).toBeNull();
    expect(pinProblem('25801', false)).toBe('رمز الدخول 4 أرقام أو 6');
    expect(pinProblem('25a0', false)).toBe('رمز الدخول أرقام فقط');
    expect(pinProblem('', false)).toBe('اكتب رمز الدخول');
  });

  it('asks an approver for 6', () => {
    expect(pinProblem('2580', true)).toBe('رمزك 6 أرقام لأنك توافق على عمليات غيرك');
    expect(pinProblem('258013', true)).toBeNull();
  });

  it('calls trivial only repeats and straight runs, over every 4-digit code', () => {
    const trivial: string[] = [];
    for (let n = 0; n < 10_000; n += 1) {
      const pin = String(n).padStart(4, '0');
      if (isTrivialPin(pin)) trivial.push(pin);
    }
    // 10 repeats, 7 rising runs (0123…6789), 7 falling runs (3210…9876).
    expect(trivial).toHaveLength(24);
    expect(trivial).toEqual(expect.arrayContaining(['0000', '0123', '6789', '9876', '3210']));
    expect(isTrivialPin('1235')).toBe(false);
    expect(isTrivialPin('1357')).toBe(false);
  });
});
