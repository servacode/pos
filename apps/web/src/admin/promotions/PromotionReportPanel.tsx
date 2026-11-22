import { useEffect, useState } from 'react';
import type { CurrencyCode, PromotionReport, PromotionReportRow } from '@serva/core';
import { EmptyState, OfferIcon } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { isoDay } from '../../lib/dates';
import { periodRange, type DayRange } from '../reports/periods';
import { Amt, Panel, PeriodChips, SxTable, type SxColumn } from '../sales/ui';
import { promotionReport } from './api';

/**
 * «أداء العروض»: for a period, what each offer did at the tills: the sales that carry it, the pieces,
 * what it took off and what those lines were sold for. The owner reads it before renewing a sale.
 */
export function PromotionReportPanel() {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [range, setRange] = useState<DayRange>(() => periodRange('month', today));
  const [report, setReport] = useState<PromotionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    setReport(null);
    setError(null);
    promotionReport(range.from, range.to).then(
      (r) => current && setReport(r),
      (e: unknown) => current && setError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [range.from, range.to, tick]);

  const columns: SxColumn<PromotionReportRow>[] = [
    {
      key: 'name',
      header: 'العرض',
      lead: true,
      // On a phone the columns that do not fit sit under the name
      cell: (r) => (
        <span style={{ whiteSpace: 'normal' }}>
          {r.name}
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted lg:hidden">
            <span>
              <bdi className="num">{r.invoices}</bdi> فاتورة
            </span>
            <span>
              بعد الخصم <Amt minor={r.netMinor} currency={r.currency as CurrencyCode} zero="dash" />
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'inv',
      header: 'فواتير',
      numeric: true,
      hideBelowLg: true,
      cell: (r) => <bdi className="num">{r.invoices}</bdi>,
    },
    {
      key: 'pieces',
      header: 'قطع بيعت',
      numeric: true,
      hideBelowLg: true,
      cell: (r) => <bdi className="num">{r.pieces}</bdi>,
    },
    {
      key: 'free',
      header: 'قطع مجانية',
      numeric: true,
      hideBelowLg: true,
      cell: (r) =>
        r.freePieces > 0 ? <bdi className="num">{r.freePieces}</bdi> : <span className="sx-z">—</span>,
    },
    {
      key: 'disc',
      header: 'كلفة الخصم',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.discountMinor} currency={r.currency as CurrencyCode} zero="dash" />,
    },
    {
      key: 'net',
      header: 'المبيعات بعد الخصم',
      numeric: true,
      hideBelowLg: true,
      cell: (r) => <Amt minor={r.netMinor} currency={r.currency as CurrencyCode} zero="dash" />,
    },
  ];

  return (
    <Panel
      title="أداء العروض"
      flush
      aside={
        <PeriodChips name="promotion-report-period" range={range} today={today} scroll onPick={setRange} />
      }
    >
      <SxTable
        bare
        caption="أداء العروض"
        columns={columns}
        rows={report?.items ?? []}
        rowKey={(r) => `${r.name}|${r.currency}`}
        loading={report === null && !error}
        {...(error ? { error } : {})}
        onRetry={() => setTick((n) => n + 1)}
        empty={
          <EmptyState
            icon={OfferIcon}
            title="لا مبيعات بعرض في هذه المدة."
            description="تظهر هنا العروض التي طبّقها الكاشير على فواتير المدة المختارة، مع كلفة خصمها."
          />
        }
      />
      <p className="border-t border-line px-4 py-2.5 text-xs text-ink-muted">
        الأرقام بعد خصم ما أُرجع من هذه القطع في المدة نفسها. أطول مدة سنة.
      </p>
    </Panel>
  );
}
