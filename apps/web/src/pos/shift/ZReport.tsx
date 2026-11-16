import { Fragment, type ReactNode } from 'react';
import type { CashMovementKind, ShiftCloseCash } from '@serva/core/contracts/documents';
import { cn, useDigits } from '@serva/ui';
import { ExactMoney } from '../ExactMoney';
import { clockText, counted, dateText, INVOICES } from '../format';
import { netMethodRows, refundVouchers, type OpenShift, type ShiftActivity } from './shift';

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

export const MOVEMENT_NAMES: Record<CashMovementKind, string> = {
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
  sellerNames,
}: {
  shift: OpenShift;
  closedAt: number;
  closedByName: string;
  activity: ShiftActivity;
  cash: readonly ShiftCloseCash[];
  baseCurrency: string;
  storeName: string;
  showDifference: boolean;
  /** Who sold: user id → name, for the sellers section */
  sellerNames?: ReadonlyMap<string, string>;
}) {
  const digits = useDigits();
  const methodName = (method: string, currency: string) =>
    `${METHOD_NAMES[method] ?? method}${method === 'cash' && currency !== baseCurrency ? ' بالدولار' : ''}`;
  const hasReturns = activity.returns.count > 0;
  // What the returns paid back, per currency: the sales' net is the gross less it (display only)
  const returnedIn = (currency: string) =>
    activity.returns.byMethod.reduce((n, r) => (r.currency === currency ? n + r.amountMinor : n), 0);
  const refundedVouchers = refundVouchers(activity);
  const cashIn = activity.cashIn;
  const hasDrawerLines =
    activity.movements.length > 0 || (cashIn?.receipts.length ?? 0) > 0 || (cashIn?.vouchers.length ?? 0) > 0;
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
        {activity.salesTotals.map((t) => (
          <Fragment key={t.currency}>
            <Line label={hasReturns ? 'إجمالي المبيعات قبل المرتجعات' : 'إجمالي المبيعات'} strong>
              <ExactMoney minor={t.totalMinor} currency={t.currency} />
            </Line>
            {t.discountMinor > 0 ? (
              <Line label="منها حسم">
                <ExactMoney minor={t.discountMinor} currency={t.currency} />
              </Line>
            ) : null}
            {hasReturns && returnedIn(t.currency) > 0 ? (
              <Line label="صافي المبيعات بعد المرتجعات" strong>
                <ExactMoney minor={t.totalMinor - returnedIn(t.currency)} currency={t.currency} />
              </Line>
            ) : null}
          </Fragment>
        ))}
        {(activity.cashRounding ?? []).map((r) => (
          <Line key={`rd:${r.currency}`} label="منها تقريب النقد">
            <ExactMoney minor={r.amountMinor} currency={r.currency} decimals={2} trimZeros />
          </Line>
        ))}
        {activity.byMethod.map((row) => {
          // 20$ taken and 800 ل.س given back: said on the dollar row itself
          const back =
            row.method === 'cash' && row.currency !== baseCurrency
              ? (activity.changeBack ?? []).filter((c) => c.paid === row.currency)
              : [];
          return (
            <Line key={`${row.method}:${row.currency}`} label={methodName(row.method, row.currency)}>
              {back.length > 0 ? (
                <>
                  <ExactMoney minor={back.reduce((n, c) => n + c.paidMinor, 0)} currency={row.currency} />{' '}
                  مستلمة
                  {back.map((c) => (
                    <span key={c.change}>
                      {' '}
                      − باقي <ExactMoney minor={c.changeMinor} currency={c.change} />
                    </span>
                  ))}
                </>
              ) : (
                <ExactMoney minor={row.amountMinor} currency={row.currency} />
              )}
            </Line>
          );
        })}
      </Section>
      {hasReturns ? (
        <Section title="المرتجعات">
          <Line label="العدد">{counted(activity.returns.count, RETURNS, digits)}</Line>
          {activity.returns.byMethod
            .filter((row) => row.method !== 'voucher')
            .map((row) => (
              <Line key={`${row.method}:${row.currency}`} label={methodName(row.method, row.currency)}>
                <ExactMoney minor={row.amountMinor} currency={row.currency} />
              </Line>
            ))}
          {refundedVouchers.map((row) => (
            <Line key={`rv:${row.currency}`} label="قسائم مرتجع صادرة">
              <ExactMoney minor={row.amountMinor} currency={row.currency} />
            </Line>
          ))}
        </Section>
      ) : null}
      {activity.returns.count > 0 ? (
        // The same figures as the closing summary: payments less the cash paid back for returns
        <Section title="الصافي بعد المرتجعات">
          {netMethodRows(activity).map((row) => (
            <Line key={`${row.method}:${row.currency}`} label={methodName(row.method, row.currency)}>
              <ExactMoney minor={row.amountMinor} currency={row.currency} />
            </Line>
          ))}
        </Section>
      ) : null}
      {activity.bySeller.length > 0 ? (
        <Section title="البائعون">
          {activity.bySeller.map((r) => (
            <Line
              key={`${r.sellerId}:${r.currency}`}
              label={
                <>
                  <bdi>{sellerNames?.get(r.sellerId) ?? 'بائع'}</bdi> · {counted(r.count, INVOICES, digits)}
                </>
              }
            >
              <ExactMoney minor={r.totalMinor} currency={r.currency} />
            </Line>
          ))}
        </Section>
      ) : null}
      {activity.vouchers.count > 0 ? (
        <Section title="قسائم الهدية المباعة والعربون">
          <Line label="العدد">{counted(activity.vouchers.count, VOUCHERS, digits)}</Line>
          {activity.vouchers.byCurrency.map((row) => (
            <Line key={row.currency} label="قيمتها">
              <ExactMoney minor={row.amountMinor} currency={row.currency} />
            </Line>
          ))}
        </Section>
      ) : null}
      <Section title="حركات الدرج">
        {!hasDrawerLines ? <span>لا حركات.</span> : null}
        {(cashIn?.receipts ?? []).map((r) => (
          <Line key={`rc:${r.currency}`} label="دفعات زبائن نقداً">
            <ExactMoney minor={r.amountMinor} currency={r.currency} />
          </Line>
        ))}
        {(cashIn?.vouchers ?? []).map((r) => (
          <Line key={`gv:${r.currency}`} label="قسائم وعربون بيعت نقداً">
            <ExactMoney minor={r.amountMinor} currency={r.currency} />
          </Line>
        ))}
        {activity.movements.map((m, i) => (
          <Line key={i} label={`${MOVEMENT_NAMES[m.kind]} · ${m.reason}`}>
            <ExactMoney minor={m.amountMinor} currency={m.currency} />
          </Line>
        ))}
      </Section>
      <hr className="border-0 border-t border-dashed border-ink" />
      <Section title="الدرج">
        {cash.map((c) => (
          <div key={c.currency} className="flex flex-col gap-0.5">
            <Line label="الافتتاح">
              <ExactMoney minor={c.openingMinor} currency={c.currency} />
            </Line>
            <Line label="المعدود" strong>
              <ExactMoney minor={c.countedMinor} currency={c.currency} />
            </Line>
            {showDifference ? (
              <>
                <Line label="المتوقع">
                  <ExactMoney minor={c.expectedMinor} currency={c.currency} />
                </Line>
                <Line label="الفرق" strong>
                  <ExactMoney minor={c.differenceMinor} currency={c.currency} />
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
