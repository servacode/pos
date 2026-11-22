import type { CurrencyCode, SupplierRow } from '@serva/core';
import { Amt } from '../sales/ui';

/** The figures strip of «المشتريات»: what is owed, this month's total and what the list shows. */
export function PurchasesStrip({
  hasSuppliers,
  totalOwedMinor,
  base,
  owing,
  owedUsd,
  month,
  active,
  summary,
}: {
  hasSuppliers: boolean;
  totalOwedMinor: number | undefined;
  base: CurrencyCode;
  owing: SupplierRow[];
  owedUsd: number;
  month: { count: number; totalMinor: number } | null | 'failed';
  active: number;
  summary: { count: number; totalMinor: number } | undefined;
}) {
  return (
    <section aria-label="أرقام المشتريات" className="sx-card sx-strip px-strip">
      <div>
        <span className="sx-eyebrow">المستحق للموردين</span>
        <span className="v big">
          {totalOwedMinor !== undefined ? <Amt minor={totalOwedMinor} currency={base} /> : '…'}
        </span>
        <span className="note">
          {owing[0] ? (
            <>
              أكبر مستحق: {owing[0].name}
              {owedUsd > 0 ? (
                <>
                  {' · '}منه <Amt minor={owedUsd} currency="USD" />
                </>
              ) : null}
            </>
          ) : hasSuppliers ? (
            'لا شيء عليك لأي مورد'
          ) : null}
        </span>
      </div>
      <div>
        <span className="sx-eyebrow">مشتريات هذا الشهر</span>
        <span className="v">
          {month === null ? (
            '…'
          ) : month === 'failed' ? (
            <span className="sx-sub">—</span>
          ) : (
            <Amt minor={month.totalMinor} currency={base} />
          )}
        </span>
        <span className="note">
          {month && month !== 'failed' ? (
            <>
              <span className="sx-n">{month.count.toLocaleString('en-US')}</span> فاتورة سارية
            </>
          ) : null}
        </span>
      </div>
      <div>
        <span className="sx-eyebrow">{active > 0 ? 'نتائج التصفية' : 'كل الفواتير'}</span>
        <span className="v">
          {summary ? <Amt minor={summary.totalMinor} currency={base} /> : <span className="sx-sub">—</span>}
        </span>
        <span className="note">
          {summary ? (
            <>
              <span className="sx-n">{summary.count.toLocaleString('en-US')}</span> فاتورة، من غير المصحَّحة
            </>
          ) : null}
        </span>
      </div>
    </section>
  );
}
