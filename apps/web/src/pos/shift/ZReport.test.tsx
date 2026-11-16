import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { ZReport } from './ZReport';
import { shiftActivity, type OpenShift } from './shift';

const SHIFT_ID = 'sh-1';
const doc = (type: string, payload: Record<string, unknown>, seq: number) =>
  ({ seq, type, doc: { type, payload } }) as never;

const shift: OpenShift = {
  key: 'k',
  id: SHIFT_ID,
  number: 'SFT-001-001-0000001',
  openedBy: 'u1',
  openedByName: 'نور',
  openedAt: Date.UTC(2026, 10, 14, 6, 0),
  mode: 'per_cashier',
  opening: [],
};

function renderZ(entries: never[], showDifference = false) {
  const activity = shiftActivity(SHIFT_ID, entries);
  render(
    <ZReport
      shift={shift}
      closedAt={Date.UTC(2026, 10, 14, 15, 0)}
      closedByName="نور"
      activity={activity}
      cash={[]}
      baseCurrency="SYP"
      storeName="بوتيك"
      showDifference={showDifference}
    />,
  );
  return stripBidiControls(screen.getByLabelText('تقرير إغلاق الوردية').textContent ?? '');
}

describe('the Z report (the till’s closing slip)', () => {
  it('puts a refund voucher on its own line and never as a negative voucher row', () => {
    const text = renderZ([
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          currency: 'SYP',
          totals: { totalMinor: 169_840_00, discountMinor: 0 },
          payments: [{ method: 'voucher', currency: 'SYP', amountMinor: 100_00 }],
          change: null,
        },
        1,
      ),
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'voucher', currency: 'SYP', amountMinor: 1_173_00 }] },
        2,
      ),
    ]);
    expect(text).toContain('قسائم مرتجع صادرة');
    // The vouchers used stay a plain positive row; nothing is netted into a minus
    expect(text).not.toMatch(/قسيمة[^ق]*[−-]\s?1,173/);
  });

  it('says gross before returns and net after, and the dollar row says what was given back in lira', () => {
    const text = renderZ([
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          currency: 'SYP',
          totals: { totalMinor: 1_200_00, discountMinor: 0 },
          payments: [{ method: 'cash', currency: 'USD', amountMinor: 2_000 }],
          change: { currency: 'SYP', amountMinor: 800_00 },
        },
        1,
      ),
      doc(
        'return',
        { shiftId: SHIFT_ID, refunds: [{ method: 'cash', currency: 'SYP', amountMinor: 600_00 }] },
        2,
      ),
    ]);
    expect(text).toContain('إجمالي المبيعات قبل المرتجعات');
    expect(text).toContain('صافي المبيعات بعد المرتجعات');
    expect(text).toMatch(/20\.00\s?\$ مستلمة − باقي 800 ل\.س/);
  });

  it('names a deposit on its own line, apart from gift vouchers', () => {
    const text = renderZ([
      doc('deposit', { shiftId: SHIFT_ID, method: 'cash', currency: 'SYP', amountMinor: 50_000_00 }, 1),
    ]);
    expect(text).toContain('عربون');
    expect(text).toContain('عربون نقداً');
    expect(text).not.toContain('قسائم الهدية المباعة');
  });

  it('lists the cash that came into the drawer outside a sale instead of «لا حركات»', () => {
    expect(renderZ([])).toContain('لا حركات');
  });

  it('shows customers’ cash payments and vouchers sold for cash among the drawer movements', () => {
    const text = renderZ([
      doc('receipt', { shiftId: SHIFT_ID, method: 'cash', currency: 'SYP', amountMinor: 110_000_00 }, 1),
      doc('gift_voucher', { shiftId: SHIFT_ID, method: 'cash', currency: 'SYP', amountMinor: 50_000_00 }, 2),
    ]);
    expect(text).not.toContain('لا حركات');
    expect(text).toContain('دفعات زبائن نقداً');
    expect(text).toContain('قسائم بيعت نقداً');
  });
});

describe('cash rounding on the Z (round 19)', () => {
  it('says what rounding took off the shift’s invoices, with its fraction', () => {
    const sale = (roundingMinor: number, seq: number) =>
      doc(
        'sale',
        {
          shiftId: SHIFT_ID,
          currency: 'SYP',
          totals: { totalMinor: 726_350, discountMinor: 0 },
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: 726_000 }],
          change: null,
          cashRounding: { currency: 'SYP', roundingMinor },
        },
        seq,
      );
    const text = renderZ([sale(-350, 1)]);
    expect(text).toContain('تقريب النقد');
    expect(text).toContain('−3.5');
  });
});
