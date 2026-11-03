import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from '@serva/sync';
import { findVoucher, tillVouchers, voucherKey } from './vouchers';

const row = (code: string, amountMinor: number, redeemedMinor = 0) => ({
  id: code,
  code,
  currency: 'SYP' as const,
  amountMinor,
  redeemedMinor,
  version: 1,
});
const ret = (number: string, amountMinor: number, method = 'voucher') =>
  ({
    doc: {
      type: 'return',
      number,
      payload: { currency: 'SYP', refunds: [{ method, currency: 'SYP', amountMinor, reference: null }] },
    },
  }) as unknown as OutboxEntry;
const spend = (code: string, baseAmountMinor: number) =>
  ({
    doc: {
      type: 'sale',
      number: 'INV-1',
      payload: { payments: [{ method: 'voucher', reference: code, baseAmountMinor }] },
    },
  }) as unknown as OutboxEntry;

describe('the vouchers a till knows', () => {
  it('adds the ones it issued before the server sends them, and never counts a spend twice', () => {
    const a = 'SRT-001-002-0000001';
    const b = 'SRT-001-002-0000002';
    const v = tillVouchers(
      [row(a, 50_000, 20_000)],
      [
        ret(a, 50_000),
        ret(b, 30_000),
        ret('SRT-001-002-0000003', 10_000, 'cash'),
        spend(a, 20_000),
        spend(b, 5_000),
      ],
    );
    // a: the server already counted this till's 200; b: only this till knows it
    expect(v.get(a)).toMatchObject({ amountMinor: 50_000, balanceMinor: 30_000 });
    expect(v.get(b)).toMatchObject({ amountMinor: 30_000, balanceMinor: 25_000 });
    expect(v.has('SRT-001-002-0000003')).toBe(false);
    // Another till spent more than this one saw
    expect(tillVouchers([row(a, 50_000, 45_000)], [spend(a, 20_000)]).get(a)!.balanceMinor).toBe(5_000);
    expect(tillVouchers([row(a, 50_000, 60_000)], []).get(a)!.balanceMinor).toBe(0);
  });

  it('finds a voucher by its code or by its sequence, and none when the digits are ambiguous', () => {
    const v = tillVouchers(
      [row('SRT-001-002-0000154', 1), row('SRT-001-003-0000154', 1), row('SRT-001-002-0001154', 1)],
      [],
    );
    expect(voucherKey(' srt-001-002-٠٠٠٠١٥٤ ')).toBe('SRT-001-002-0000154');
    expect(findVoucher(v, 'srt-001-002-0000154')!.code).toBe('SRT-001-002-0000154');
    expect(findVoucher(v, '1154')!.code).toBe('SRT-001-002-0001154');
    expect(findVoucher(v, '154')).toBeNull();
    expect(findVoucher(v, '0030000154')!.code).toBe('SRT-001-003-0000154');
    expect(findVoucher(v, '')).toBeNull();
    expect(findVoucher(v, 'INV-1')).toBeNull();
  });
});
