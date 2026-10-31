import { useState, type ReactNode } from 'react';
import type { CurrencyCode, MeResponse } from '@serva/core';
import {
  Button,
  Card,
  cn,
  DataTable,
  displayNumber,
  EmptyState,
  Money,
  PrintIcon,
  SalesIcon,
  StatTile,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { DAY_REPORT_ACCESS } from './access';
import { getDayReport } from './api';
import type { DayReport } from './contracts';
import { methodLabel } from './labels';
import {
  BranchSelect,
  DayField,
  defaultBranch,
  PageHead,
  ReportError,
  ReportLoading,
  ReportScreen,
  Section,
} from './parts';
import { useReport } from './useReport';

type MethodRow = DayReport['byMethod'][number];
type CashierRow = DayReport['byCashier'][number];

function branchName(me: MeResponse, branchId: string | null): string {
  if (!branchId) return 'كل الفروع';
  return me.branches.find((branch) => branch.id === branchId)?.name ?? 'الفرع';
}

/** One line of the breakdown: the label and the amount, the total line in bold. */
function Line({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5',
        strong && 'border-t border-line pt-2.5 font-bold',
      )}
    >
      <dt className={strong ? 'text-ink' : 'text-ink-muted'}>{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function Breakdown({ report }: { report: DayReport }) {
  const base = report.baseCurrency;
  return (
    <dl className="flex flex-col">
      <Line label="المبيعات قبل الحسم والضريبة">
        <Money minor={report.grossMinor} currency={base} />
      </Line>
      <Line label="الحسم">
        <Money minor={-report.discountMinor} currency={base} />
      </Line>
      <Line label="الصافي قبل الضريبة">
        <Money minor={report.netExTaxMinor} currency={base} />
      </Line>
      <Line label="الضريبة">
        <Money minor={report.taxMinor} currency={base} />
      </Line>
      <Line label="مجموع الفواتير" strong>
        <Money minor={report.totalMinor} currency={base} />
      </Line>
      <Line label="تقريب النقد">
        <Money minor={report.cashRoundingMinor} currency={base} />
      </Line>
      <Line label="الإكرامية">
        <Money minor={report.tipsMinor} currency={base} />
      </Line>
    </dl>
  );
}

function methodColumns(base: CurrencyCode): DataColumn<MethodRow>[] {
  return [
    {
      key: 'method',
      header: 'الطريقة',
      cell: (row) => <span className="font-semibold">{methodLabel(row.method, row.currency, base)}</span>,
      total: 'المجموع',
    },
    { key: 'count', header: 'الدفعات', numeric: true, cell: (row) => row.count },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (row) => <Money minor={row.amountMinor} currency={row.currency} />,
    },
    {
      key: 'base',
      header: 'بالعملة الأساسية',
      numeric: true,
      cell: (row) => <Money minor={row.baseAmountMinor} currency={base} />,
    },
  ];
}

function cashierColumns(base: CurrencyCode): DataColumn<CashierRow>[] {
  return [
    {
      key: 'name',
      header: 'الكاشير',
      cell: (row) => <span className="font-semibold">{row.fullName}</span>,
      total: 'المجموع',
    },
    { key: 'count', header: 'الفواتير', numeric: true, cell: (row) => row.invoiceCount },
    {
      key: 'total',
      header: 'المبيعات',
      numeric: true,
      cell: (row) => <Money minor={row.totalMinor} currency={base} />,
    },
  ];
}

function withTotals<Row>(columns: DataColumn<Row>[], totals: Record<string, ReactNode>): DataColumn<Row>[] {
  return columns.map((column) => (column.key in totals ? { ...column, total: totals[column.key] } : column));
}

function DayReportBody({ report }: { report: DayReport }) {
  const digits = useDigits();
  const base = report.baseCurrency;
  const average = report.invoiceCount > 0 ? Math.round(report.totalMinor / report.invoiceCount) : 0;
  const methodsBase = report.byMethod.reduce((sum, row) => sum + row.baseAmountMinor, 0);
  const cashierInvoices = report.byCashier.reduce((sum, row) => sum + row.invoiceCount, 0);
  const cashierTotal = report.byCashier.reduce((sum, row) => sum + row.totalMinor, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          hero
          className="sm:col-span-2"
          label="المبيعات"
          value={<Money minor={report.totalMinor} currency={base} />}
          footnote={
            <>
              <bdi className="num">{displayNumber(String(report.invoiceCount), digits)}</bdi> فاتورة · متوسطها{' '}
              <Money minor={average} currency={base} />
            </>
          }
        />
        <StatTile label="الحسم" value={<Money minor={report.discountMinor} currency={base} />} />
        <StatTile label="الضريبة" value={<Money minor={report.taxMinor} currency={base} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Section title="تفصيل المبيعات">
          <Breakdown report={report} />
        </Section>
        <Section title="حسب طريقة الدفع">
          <DataTable
            caption="المبيعات حسب طريقة الدفع والعملة"
            columns={withTotals(methodColumns(base), {
              base: <Money minor={methodsBase} currency={base} />,
            })}
            rows={report.byMethod}
            rowKey={(row) => `${row.method}-${row.currency}`}
          />
          <p className="text-sm text-ink-muted">
            الدولار محسوب بسعر كل فاتورة. البطاقة وشام كاش تُطابقان مع الكشف، لا مع الدرج.
          </p>
        </Section>
      </div>

      <Section title="حسب الكاشير">
        <DataTable
          caption="المبيعات حسب الكاشير"
          columns={withTotals(cashierColumns(base), {
            count: cashierInvoices,
            total: <Money minor={cashierTotal} currency={base} />,
          })}
          rows={report.byCashier}
          rowKey={(row) => row.userId}
        />
      </Section>
    </>
  );
}

/** The A4 print of the day (21 › التقارير على A4): the same numbers, on paper. */
function DayReportSheet({ report, me, title }: { report: DayReport; me: MeResponse; title: string }) {
  const base = report.baseCurrency;
  return (
    <div dir="rtl" className="flex flex-col gap-4 p-2 text-sm text-ink">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <div>
          <p className="text-lg font-bold">{me.tenant.name}</p>
          <p>{title}</p>
        </div>
        <p className="text-xl font-bold">مبيعات اليوم</p>
      </div>
      <Breakdown report={report} />
      <table className="w-full border-collapse">
        <caption className="py-1 text-start font-semibold">حسب طريقة الدفع</caption>
        <tbody>
          {report.byMethod.map((row) => (
            <tr key={`${row.method}-${row.currency}`} className="border-b border-line">
              <td className="py-1">{methodLabel(row.method, row.currency, base)}</td>
              <td className="num py-1 text-end">{row.count}</td>
              <td className="py-1 text-end">
                <Money minor={row.amountMinor} currency={row.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <caption className="py-1 text-start font-semibold">حسب الكاشير</caption>
        <tbody>
          {report.byCashier.map((row) => (
            <tr key={row.userId} className="border-b border-line">
              <td className="py-1">{row.fullName}</td>
              <td className="num py-1 text-end">{row.invoiceCount}</td>
              <td className="py-1 text-end">
                <Money minor={row.totalMinor} currency={base} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * «مبيعات اليوم» (19 › تقرير اليوم; admin/Home › مبيعات اليوم, admin/Reports › العارض): the day's
 * invoices, discounts, tax, rounding and tips for a branch or all of them, by payment method and
 * currency and by cashier, with an A4 print.
 */
export function DayReportPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [date, setDate] = useState(today);
  const { data, error, loading, retry } = useReport(`${branchId ?? ''}|${date}`, () =>
    getDayReport({ branchId, date }),
  );
  const { paper, print } = usePrint();
  const title = `${branchName(me, branchId)} · ${dayText(date, digits)}`;
  const isToday = date === today;

  return (
    <ReportScreen me={me} access={DAY_REPORT_ACCESS} title="مبيعات اليوم">
      <PageHead
        crumbs={['البيع', 'المبيعات']}
        title={isToday ? 'مبيعات اليوم' : 'مبيعات يوم'}
        subtitle={title}
        actions={
          <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
            اطبع
          </Button>
        }
      />

      <Card className="flex flex-wrap items-end gap-4 print:hidden">
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
        <DayField label="اليوم" value={date} max={today} onChange={setDate} />
      </Card>

      {loading ? <ReportLoading label="نحمّل مبيعات اليوم…" /> : null}
      {error ? <ReportError message={error} onRetry={retry} /> : null}
      {data && data.invoiceCount === 0 ? (
        <Card>
          <EmptyState
            icon={SalesIcon}
            title={isToday ? 'لا مبيعات اليوم بعد.' : 'لا مبيعات في هذا اليوم.'}
            description={
              isToday ? 'تظهر هنا فواتير اليوم لحظة وصولها من أجهزة الكاشير.' : 'اختر يوماً آخر أو فرعاً آخر.'
            }
          />
        </Card>
      ) : null}
      {data && data.invoiceCount > 0 ? <DayReportBody report={data} /> : null}

      {data && paper ? (
        <PrintSheet paper={paper}>
          <DayReportSheet report={data} me={me} title={title} />
        </PrintSheet>
      ) : null}
    </ReportScreen>
  );
}
