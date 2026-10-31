import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, trialBalance } from '../../test/reports';
import type { AccountType } from '../reports/contracts';
import { accountTree } from './ChartOfAccountsPage';
import { csvField, debitSigned, minorToDecimal, trialBalanceCsv } from './csv';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const minor = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

describe('minorToDecimal', () => {
  it('writes the stored amount as a plain decimal', () => {
    expect(minorToDecimal(125_000, 'SYP')).toBe('1250.00');
    expect(minorToDecimal(-5, 'USD')).toBe('-0.05');
    expect(minorToDecimal(0, 'USD')).toBe('0.00');
  });

  it('loses no qirsh: reading the decimal back gives the same minor units', () => {
    fc.assert(
      fc.property(minor, (value) => {
        const text = minorToDecimal(value, 'SYP');
        expect(BigInt(text.replace('.', ''))).toBe(BigInt(value));
        expect(text).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });
});

describe('debitSigned', () => {
  it('keeps debit-side accounts and turns credit-side ones', () => {
    expect(debitSigned(500, 'asset')).toBe(500);
    expect(debitSigned(500, 'expense')).toBe(500);
    expect(debitSigned(500, 'revenue')).toBe(-500);
    expect(debitSigned(500, 'liability')).toBe(-500);
    expect(debitSigned(500, 'equity')).toBe(-500);
  });

  it('is its own inverse on the same side, and keeps the size', () => {
    fc.assert(
      fc.property(minor, fc.constantFrom(...TYPES), (value, type) => {
        const once = debitSigned(value, type);
        expect(Math.abs(once)).toBe(Math.abs(value));
        expect(debitSigned(once, type)).toBe(value === 0 ? 0 : value);
      }),
    );
  });
});

describe('csvField', () => {
  it('quotes, doubles inner quotes, and defuses formulas in text', () => {
    expect(csvField('المبيعات "النقدية"')).toBe('"المبيعات ""النقدية"""');
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField('+1')).toBe('"\'+1"');
    expect(csvField('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvField('-120.00', true)).toBe('"-120.00"');
  });
});

describe('trialBalanceCsv', () => {
  it('splits every balance into debit and credit columns and ends with the totals', () => {
    const csv = trialBalanceCsv(trialBalance(), 'SYP');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toEqual([
      '"رمز الحساب","اسم الحساب","رصيد أول المدة مدين","رصيد أول المدة دائن","مدين","دائن","رصيد آخر المدة مدين","رصيد آخر المدة دائن"',
      '"1110","الصندوق (أدراج الكاشير)","0.00","0.00","1200.00","0.00","1200.00","0.00"',
      '"4100","المبيعات","0.00","0.00","0.00","1200.00","0.00","1200.00"',
      '"","المجموع","","","1200.00","1200.00","",""',
      '',
    ]);
  });

  it('a balanced trial balance stays balanced in the file: closing debits equal closing credits', () => {
    const row = fc.record({
      type: fc.constantFrom(...TYPES),
      closingMinor: fc.integer({ min: -1e12, max: 1e12 }),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 20 }), (rows) => {
        // Close the books: one equity line takes the other side of everything.
        const net = rows.reduce((sum, r) => sum + debitSigned(r.closingMinor, r.type), 0);
        const all = [...rows, { type: 'equity' as const, closingMinor: net }];
        const report = trialBalance({
          rows: all.map((r, i) => ({
            accountCode: String(1000 + i),
            accountName: `حساب ${i}`,
            type: r.type,
            openingMinor: 0,
            debitMinor: 0,
            creditMinor: 0,
            closingMinor: r.closingMinor,
          })),
        });
        const body = trialBalanceCsv(report, 'SYP').slice(1).split('\r\n').slice(1, -2);
        let debit = 0n;
        let credit = 0n;
        for (const line of body) {
          const cells = line.split('","').map((cell) => cell.replaceAll('"', ''));
          debit += BigInt(cells[6]!.replace('.', ''));
          credit += BigInt(cells[7]!.replace('.', ''));
        }
        expect(debit).toBe(credit);
      }),
    );
  });
});

describe('accountTree', () => {
  it('nests by parent code, sorts by code, and keeps an orphan as a root', () => {
    const orphan = { ...ACCOUNTS[1]!, id: 'x', code: '9100', parentCode: '9' };
    const tree = accountTree([...ACCOUNTS].reverse().concat(orphan));
    expect(tree.map((n) => n.account.code)).toEqual(['1', '4', '9100']);
    expect(tree[0]!.children.map((n) => n.account.code)).toEqual(['1110', '1111']);
  });

  it('places every account exactly once, whatever the order it arrives in', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(ACCOUNTS, { minLength: ACCOUNTS.length }), (shuffled) => {
        const seen: string[] = [];
        const walk = (nodes: ReturnType<typeof accountTree>) => {
          for (const node of nodes) {
            seen.push(node.account.code);
            walk(node.children);
          }
        };
        walk(accountTree(shuffled));
        expect(seen).toEqual(['1', '1110', '1111', '4', '4100']);
      }),
    );
  });
});
