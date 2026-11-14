import type { ReactNode } from 'react';
import type { CashMovementKind, ShiftCloseCash } from '@serva/core/contracts/documents';
import { cn, Money, useDigits } from '@serva/ui';
import { clockText, counted, dateText, INVOICES } from '../format';
import type { OpenShift, ShiftActivity } from './shift';

const METHOD_NAMES: Record<string, string> = {
  cash: 'نقد',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل',
  cheque: 'شيك',
  voucher: 'قسيمة',
  points: 'نقاط',
  account: 'إلى حساب الزبون',
};

const MOVEMENT_NAMES: Record<CashMovementKind, string> = {
  pay_in: 'إيداع في الدرج',
  pay_out: 'سحب من الدرج',
  expense: 'مصروف',
  safe_drop: 'إيداع للخزنة',
};

const RETURNS = ['مرتجع واحد', 'مرتجعان', 'مرتجعات', 'مرتجعاً'] as const;
const VOUCHERS = ['قسيمة واحدة', 'قسيمتان', 'قسائم', 'قسيمة'] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Line({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="num text-end">{children}</span>
    </div>
  );
}

/**
 * «تقرير الإغلاق» (Z): what the shift did, on one slip: the sales by payment method and currency,
 * the returns, the vouchers sold, the drawer movements, and the drawers counted. The expected cash
 * and the difference are printed only for a role that may see them (the blind close of 11/16): a
 * cashier's copy carries the count alone.
 */
export function ZReport({
  shift,
  closedAt,
  closedByName,
  activity,
  cash,
  baseCurrency,
  storeName,
  showDifference,
}: {
  shift: OpenShift;
  closedAt: number;
  closedByName: string;
  activity: ShiftActivity;
  cash: readonly ShiftCloseCash[];
  baseCurrency: string;
  storeName: string;
  showDifference: boolean;
}) {
  const digits = useDigits();
  const methodName = (method: string, currency: string) =>
    `${METHOD_NAMES[method] ?? method}${method === 'cash' && currency !== baseCurrency ? ' بالدولار' : ''}`;
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label="تقرير إغلاق الوردية"
      className="flex w-[72mm] flex-col gap-3 bg-surface px-1 py-3 text-[13px]/[1.55] font-semibold text-ink"
    >
      <div className="flex flex-col items-center text-center">
        <span className="text-xl font-bold">{storeName}</span>
        <span>تقرير إغلاق الوردية (Z)</span>
        <bdi dir="ltr" className="num font-bold">
          {shift.number}
        </bdi>
        <span>
          {dateText(closedAt, digits)} ، {clockText(closedAt, digits)}
        </span>
      </div>
      <hr className="border-0 border-t border-dashed border-ink" />
      <Line label="فُتحت">
        {shift.openedByName} · {clockText(shift.openedAt, digits)}
      </Line>
      <Line label="أُغلقت">
        {closedByName} · {clockText(closedAt, digits)}
      </Line>
      <Section title="المبيعات">
        <Line label="عدد الفواتير" strong>
          {counted(activity.saleCount, INVOICES, digits)}
        </Line>
        {activity.byMethod.map((row) => (
          <Line key={`${row.method}:${row.currency}`} label={methodName(row.method, row.currency)}>
            <Money minor={row.amountMinor} currency={row.currency} />
          </Line>
        ))}
      </Section>
      <Section title="المرتجعات">
        <Line label="العدد">{counted(activity.returns.count, RETURNS, digits)}</Line>
        {activity.returns.byMethod.map((row) => (
          <Line key={`${row.method}:${row.currency}`} label={methodName(row.method, row.currency)}>
            <Money minor={row.amountMinor} currency={row.currency} />
          </Line>
        ))}
      </Section>
      <Section title="قسائم الهدية المباعة وعربون التأجير">
        <Line label="العدد">{counted(activity.vouchers.count, VOUCHERS, digits)}</Line>
        {activity.vouchers.byCurrency.map((row) => (
          <Line key={row.currency} label="قيمتها">
            <Money minor={row.amountMinor} currency={row.currency} />
          </Line>
        ))}
      </Section>
      <Section title="حركات الدرج">
        {activity.movements.length === 0 ? <span>لا حركات.</span> : null}
        {activity.movements.map((m, i) => (
          <Line key={i} label={`${MOVEMENT_NAMES[m.kind]} · ${m.reason}`}>
            <Money minor={m.amountMinor} currency={m.currency} />
          </Line>
        ))}
      </Section>
      <hr className="border-0 border-t border-dashed border-ink" />
      <Section title="الدرج">
        {cash.map((c) => (
          <div key={c.currency} className="flex flex-col gap-0.5">
            <Line label="الافتتاح">
              <Money minor={c.openingMinor} currency={c.currency} />
            </Line>
            <Line label="المعدود" strong>
              <Money minor={c.countedMinor} currency={c.currency} />
            </Line>
            {showDifference ? (
              <>
                <Line label="المتوقع">
                  <Money minor={c.expectedMinor} currency={c.currency} />
                </Line>
                <Line label="الفرق" strong>
                  <Money minor={c.differenceMinor} currency={c.currency} />
                </Line>
              </>
            ) : null}
          </div>
        ))}
      </Section>
      <p className="text-center text-[10px]">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}
