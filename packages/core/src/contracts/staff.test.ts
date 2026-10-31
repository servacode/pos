import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isTrivialPin,
  pinLockSeconds,
  PIN_LOCK_MAX_SECONDS,
  requiredPinLength,
  setPinInput,
  staffSessionInput,
} from './staff';

const USER_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04';

describe('setPinInput', () => {
  it('accepts 4 or 6 digits, Arabic digits read as Latin', () => {
    expect(setPinInput.parse({ pin: '٢٤٦٨', password: 'x' })).toEqual({ pin: '2468', password: 'x' });
    expect(setPinInput.parse({ pin: ' 285713 ', password: 'x' }).pin).toBe('285713');
  });

  it.each(['123', '12345', '1234567', '12a4', ''])('refuses %j (not 4 or 6 digits)', (pin) => {
    const result = setPinInput.safeParse({ pin, password: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('رمز الدخول 4 أو 6 أرقام');
  });

  it.each(['1234', '0000', '123456', '999999', '4321', '987654', '٠٠٠٠'])(
    'refuses the trivial PIN %s',
    (pin) => {
      const result = setPinInput.safeParse({ pin, password: 'x' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('هذا الرمز سهل التخمين. اختر رمزاً آخر');
    },
  );

  it('needs the password', () => {
    expect(setPinInput.safeParse({ pin: '2468', password: '' }).success).toBe(false);
    expect(setPinInput.safeParse({ pin: '2468' }).success).toBe(false);
  });
});

describe('staffSessionInput', () => {
  it('takes a user id and a 4- or 6-digit PIN', () => {
    expect(staffSessionInput.parse({ userId: USER_ID, pin: '١٣٥٧' })).toEqual({ userId: USER_ID, pin: '1357' });
    expect(staffSessionInput.safeParse({ userId: 'x', pin: '1357' }).success).toBe(false);
    expect(staffSessionInput.safeParse({ userId: USER_ID, pin: '13579' }).success).toBe(false);
  });
});

describe('isTrivialPin', () => {
  it('is true exactly for one repeated digit or a run up or down by one', () => {
    fc.assert(
      fc.property(fc.constantFrom(4, 6), fc.integer({ min: 0, max: 999_999 }), (length, n) => {
        const pin = String(n % 10 ** length).padStart(length, '0');
        const d = [...pin].map(Number);
        const same = d.every((x) => x === d[0]);
        const up = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
        const down = d.every((x, i) => i === 0 || x === d[i - 1]! - 1);
        expect(isTrivialPin(pin)).toBe(same || up || down);
      }),
    );
  });
});

describe('requiredPinLength', () => {
  it('asks owners, managers and approvers for 6 digits, cashiers for 4', () => {
    expect(requiredPinLength(['owner'], [])).toBe(6);
    expect(requiredPinLength(['manager'], [])).toBe(6);
    expect(requiredPinLength(['cashier'], ['sale.create', 'sale.discount', 'shift.close_own'])).toBe(4);
    expect(requiredPinLength(['supervisor'], ['sale.create', 'sale.discount_over_limit'])).toBe(6);
    expect(requiredPinLength(['custom'], ['cash.move'])).toBe(6);
  });
});

describe('pinLockSeconds', () => {
  it('locks from the fifth failure for a minute, doubling after, up to a day', () => {
    expect([0, 1, 4].map(pinLockSeconds)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8].map(pinLockSeconds)).toEqual([60, 120, 240, 480]);
    expect(pinLockSeconds(16)).toBe(PIN_LOCK_MAX_SECONDS);
    expect(pinLockSeconds(1_000_000)).toBe(PIN_LOCK_MAX_SECONDS);
  });
});
