import { useState } from 'react';
import type { WasteReport, WasteRow } from '@serva/core';
import {
  DataTable,
  DeleteIcon,
  formatQuantity,
  Money,
  PageHeader,
  SegmentedControl,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { apiFetch } from '../../lib/api';
import { daysAgo } from './MerchandisePage';
import { useReport } from './useReport';

const PERIODS = { '7': 'آخر 7 أيام', '30': 'آخر 30 يوماً', '90': 'آخر 3 أشهر' } as const;
const VIEWS = { reason: 'بحسب السبب', product: 'بحسب الصنف', rows: 'كل الحركات' } as const;

export const getWasteReport = (from: string, to: string) =>
  apiFetch<WasteReport>(`/v1/reports/waste?from=${from}&to=${to}`, { auth: true });

/**
 * «التالف والهدر» (round 38, #41): what left the stock as waste in a period, by reason, by product, or move by
 * move, with its cost. It reads the stock counts that carry a waste reason (the till's «تالف / هدر» and the
 * inventory page's «سجّل هدراً»), so it always agrees with the books.
 */
export function WasteReportPage() {
  const digits = useDigits();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30');
  const [view, setView] = useState<keyof typeof VIEWS>('reason');
  const from = daysAgo(Number(period) - 1);
  const to = daysAgo(0);
  const report = useReport(`waste:${from}:${to}`, () => getWasteReport(from, to));
  const data = report.data;
  const base = data?.baseCurrency ?? 'SYP';

  const cost = (minor: number) => <Money minor={minor} currency={base} className="font-semibold" />;
  const qty = (thousandths: number) => <bdi className="num">{formatQuantity(thousandths, digits)}</bdi>;

  const reasonColumns: DataColumn<WasteReport['byReason'][number]>[] = [
    { key: 'reason', header: 'السبب', cell: (r) => r.reason },
    { key: 'cost', header: 'الكلفة', numeric: true, cell: (r) => cost(r.costMinor) },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => qty(r.qty) },
    { key: 'count', header: 'المرات', numeric: true, cell: (r) => <bdi className="num">{r.count}</bdi> },
  ];
  const productColumns: DataColumn<WasteReport['byProduct'][number]>[] = [
    { key: 'name', header: 'الصنف', className: 'min-w-32', cell: (r) => <bdi>{r.name}</bdi> },
    { key: 'cost', header: 'الكلفة', numeric: true, cell: (r) => cost(r.costMinor) },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => qty(r.qty) },
    { key: 'count', header: 'المرات', numeric: true, cell: (r) => <bdi className="num">{r.count}</bdi> },
  ];
  const rowColumns: DataColumn<WasteRow>[] = [
    { key: 'date', header: 'التاريخ', cell: (r) => <bdi className="num">{r.date}</bdi> },
    { key: 'name', header: 'الصنف', className: 'min-w-32', cell: (r) => <bdi>{r.name}</bdi> },
    { key: 'reason', header: 'السبب', cell: (r) => r.reason },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => qty(r.qty) },
    { key: 'cost', header: 'الكلفة', numeric: true, cell: (r) => cost(r.costMinor) },
  ];
  const state = {
    loading: report.loading,
    ...(report.error ? { error: report.error, onRetry: report.retry } : {}),
  };

  return (
    <AppShell>
      <title>التالف والهدر · SERFA</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          icon={<DeleteIcon />}
          title="التالف والهدر"
          description={
            data ? (
              <>
                خرج من المخزون بكلفة <Money minor={data.totalCostMinor} currency={base} /> في هذه الفترة.
              </>
            ) : (
              'ما خرج من المخزون تالفاً أو مهدوراً، بسببه وصنفه وكلفته.'
            )
          }
          actions={
            <SegmentedControl
              label="الفترة"
              value={period}
              onValueChange={setPeriod}
              options={(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((value) => ({
                value,
                label: PERIODS[value],
              }))}
            />
          }
        />
        <SegmentedControl
          label="عرض"
          value={view}
          onValueChange={setView}
          options={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((value) => ({
            value,
            label: VIEWS[value],
          }))}
        />
        {view === 'reason' ? (
          <DataTable
            caption="التالف بحسب السبب"
            columns={reasonColumns}
            rows={data?.byReason ?? []}
            rowKey={(r) => r.reason}
            empty="لا تالف مسجّل في هذه الفترة."
            {...state}
          />
        ) : view === 'product' ? (
          <DataTable
            caption="التالف بحسب الصنف"
            columns={productColumns}
            rows={data?.byProduct ?? []}
            rowKey={(r) => r.variantId}
            empty="لا تالف مسجّل في هذه الفترة."
            {...state}
          />
        ) : (
          <DataTable
            caption="حركات التالف"
            columns={rowColumns}
            rows={data?.rows ?? []}
            rowKey={(r) => `${r.number}:${r.variantId}`}
            empty="لا تالف مسجّل في هذه الفترة."
            {...state}
          />
        )}
      </div>
    </AppShell>
  );
}
