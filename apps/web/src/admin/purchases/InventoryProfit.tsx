import { useState, type ReactNode } from 'react';
import type { InventoryResponse, ProfitReport } from '@serva/core';
import { AlertCircleIcon, displayNumber, type Digits } from '@serva/ui';
import { Amt } from '../sales/ui';

/** The month's gross profit inside the figures card: one line, and the details open under it */
export function InventoryProfit({
  profit,
  base,
  digits,
}: {
  profit: ProfitReport | null;
  base: InventoryResponse['baseCurrency'];
  digits: Digits;
}) {
  // The month's profit is open on a wide screen and folded on a phone (the list is what the phone came for)
  const [profitOpen, setProfitOpen] = useState(false);
  if (!profit) return null;
  const costOfSales = profit.costOfSalesMinor ?? 0;
  const margin =
    profit.netSalesMinor > 0 && costOfSales > 0
      ? (profit.grossProfitMinor / profit.netSalesMinor) * 100
      : null;
  return (
    <div className="ix-profit">
      <p className="note">
        ربح هذا الشهر (مجمل): <Amt minor={profit.grossProfitMinor} currency={base} className="font-bold" />{' '}
        <button
          type="button"
          className="sx-linkbtn"
          aria-expanded={profitOpen}
          onClick={() => setProfitOpen((now) => !now)}
        >
          {profitOpen ? 'أخفِ التفاصيل' : 'التفاصيل'}
        </button>
      </p>
      {profitOpen ? (
        <>
          <p className="sx-wait">من الدفاتر، من أول الشهر حتى اليوم، بعد المرتجع وبدون الضريبة.</p>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure term="صافي المبيعات هذا الشهر">
              <Amt minor={profit.netSalesMinor} currency={base} />
            </Figure>
            <Figure term="كلفة المبيعات">
              <Amt minor={profit.costOfSalesMinor} currency={base} />
            </Figure>
            <Figure term="مجمل الربح">
              <Amt minor={profit.grossProfitMinor} currency={base} />
            </Figure>
          </dl>
          {margin !== null ? (
            <p className="sx-note tight">
              هامش <bdi className="sx-n font-semibold">{displayNumber(margin.toFixed(1), digits)}%</bdi> من
              صافي المبيعات
            </p>
          ) : profit.netSalesMinor > 0 && costOfSales === 0 ? (
            <p className="ix-warn" role="note" style={{ marginTop: 12 }}>
              <AlertCircleIcon size={20} />
              الكلفة غير مسجلة لهذه المبيعات: الهامش غير دقيق، فلا نعرضه.
            </p>
          ) : null}
          {profit.stockLossMinor ? (
            <p className="sx-note tight">
              {profit.stockLossMinor > 0 ? 'تلف وفقد' : 'زيادة جرد'}:{' '}
              <Amt minor={Math.abs(profit.stockLossMinor)} currency={base} />
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One figure of the month's profit: its name, then the amount. */
function Figure({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="sx-eyebrow">{term}</dt>
      <dd className="text-xl font-bold text-ink" style={{ margin: 0 }}>
        {children}
      </dd>
    </div>
  );
}
