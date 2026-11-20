import { useState, type ReactNode } from 'react';
import { type CurrencyCode, type MeResponse } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  cn,
  displayNumber,
  EmptyState,
  formatQuantity,
  PrintIcon,
  SalesIcon,
  UndoIcon,
  InfoIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import {
  Amt,
  BarList,
  DayStepper,
  PageTop,
  Panel,
  PeriodChips,
  SalesPage,
  SERIES,
  share,
  Stack,
  SxTable,
  Track,
  type BarItem,
} from '../sales/ui';
import { DAY_REPORT_ACCESS } from './access';
import { getDayReport, getDayTotals, type DayTotal } from './api';
import type { DayReport } from './contracts';
import { methodLabel } from './labels';
import { useOpenShiftFromYesterday } from './openShift';
import { addDays, type DayRange } from './periods';
import { BranchSelect, DayField, defaultBranch, ReportError, ReportLoading, ReportScreen } from './parts';
import { useReport } from './useReport';

type CashierRow = DayReport['byCashier'][number];

function branchName(me: MeResponse, branchId: string | null): string {
  if (!branchId) return 'كل الفروع';
  return me.branches.find((branch) => branch.id === branchId)?.name ?? 'الفرع';
}

/** One line of the printed breakdown: the label and the amount, the total line in bold. */
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

/** The day's breakdown as the A4 print has it */
function Breakdown({ report }: { report: DayReport }) {
  const base = report.baseCurrency;
  return (
    <dl className="flex flex-col">
      <Line label="المبيعات قبل الحسم والضريبة">
        <Amt minor={report.grossMinor} currency={base} />
      </Line>
      <Line label="الحسم">
        <Amt minor={-report.discountMinor} currency={base} />
      </Line>
      <Line label="الصافي قبل الضريبة">
        <Amt minor={report.netExTaxMinor} currency={base} />
      </Line>
      {report.taxMinor !== 0 ? (
        <Line label="الضريبة">
          <Amt minor={report.taxMinor} currency={base} />
        </Line>
      ) : null}
      <Line label="مجموع الفواتير" strong>
        <Amt minor={report.totalMinor} currency={base} />
      </Line>
      {report.returns.count > 0 ? (
        <>
          <Line label={`المرتجعات (${report.returns.count})`}>
            <Amt minor={-report.returns.totalMinor} currency={base} />
          </Line>
          <Line label="صافي المبيعات بعد المرتجعات" strong>
            <Amt minor={report.netSalesMinor} currency={base} />
          </Line>
        </>
      ) : null}
      {report.collections.count > 0 ? (
        <Line label={`دفعات من الزبائن (${report.collections.count})`}>
          <Amt minor={report.collections.totalMinor} currency={base} />
        </Line>
      ) : null}
      <Line label="تقريب النقد">
        <Amt minor={report.cashRoundingMinor} currency={base} />
      </Line>
      <Line label="الإكرامية">
        <Amt minor={report.tipsMinor} currency={base} />
      </Line>
    </dl>
  );
}

/** «39,911 ل.س» big, with its pills: the headline of a day or of a range */
function Hero({
  label,
  net,
  before,
  returnsCount,
  usdCash,
  base,
}: {
  label: string;
  net: number;
  /** The invoices' total before the returns, said when there are returns */
  before: number | null;
  returnsCount: number;
  usdCash: { minor: number; currency: CurrencyCode } | null;
  base: CurrencyCode;
}) {
  const digits = useDigits();
  return (
    <section className="sx-card sx-hero sx-c7" aria-label={label}>
      <div>
        <span className="sx-eyebrow">{label}</span>
        <div className="sx-big">
          <Amt minor={net} currency={base} />
        </div>
        <div className="sx-meta">
          {before !== null ? (
            <span className="sx-pill">
              مجموع الفواتير قبل المرتجعات <Amt minor={before} currency={base} />
            </span>
          ) : null}
          {returnsCount > 0 ? (
            <span className="sx-pill">
              <UndoIcon size={16} />
              <b className="sx-n">{displayNumber(String(returnsCount), digits)}</b> مرتجعات
            </span>
          ) : null}
          {usdCash ? (
            <span className="sx-pill">
              نقداً بالدولار <Amt minor={usdCash.minor} currency={usdCash.currency} />
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The three figures beside the headline: invoices, the average, the returns */
function Kpis({
  count,
  average,
  returns,
  base,
}: {
  count: number;
  average: number;
  returns: number;
  base: CurrencyCode;
}) {
  const digits = useDigits();
  return (
    <section className="sx-card sx-kpis sx-c5" aria-label="أرقام اليوم">
      <div className="sx-kpi">
        <span className="sx-mute">عدد الفواتير</span>
        <span className="v sx-n">{displayNumber(String(count), digits)}</span>
      </div>
      <div className="sx-kpi">
        <span className="sx-mute">متوسط الفاتورة</span>
        <span className="v">
          <Amt minor={average} currency={base} />
        </span>
      </div>
      <div className="sx-kpi">
        <span className="sx-mute">المرتجعات</span>
        <span className="v">
          <Amt minor={returns} currency={base} neg={returns > 0} />
        </span>
      </div>
    </section>
  );
}

/** One row of the walk from the sales to the net: a label, its bar, its figure */
function Step({
  label,
  w,
  s,
  color,
  tone,
  children,
}: {
  label: string;
  w: number;
  s?: number;
  color?: string;
  tone?: 'sub' | 'key';
  children: ReactNode;
}) {
  return (
    <div className={cn('sx-fr', tone)}>
      <dt>{label}</dt>
      <Track w={w} s={s} color={color} />
      <dd>{children}</dd>
    </div>
  );
}

/** «من المبيعات إلى الصافي»: the day's figures one under the other, each with its share of the sales */
function Waterfall({ report, methodsBase }: { report: DayReport; methodsBase: number }) {
  const base = report.baseCurrency;
  const max = Math.max(report.grossMinor, report.totalMinor, 1);
  const pct = (value: number) => share(value, max);
  const hasReturns = report.returns.count > 0;
  const net = report.netSalesMinor;
  return (
    <dl className="sx-fall">
      <Step label="المبيعات قبل الحسم والضريبة" w={pct(report.grossMinor)}>
        <Amt minor={report.grossMinor} currency={base} />
      </Step>
      <Step
        label="الحسم"
        tone="sub"
        s={pct(report.grossMinor - report.discountMinor)}
        w={pct(report.discountMinor)}
      >
        <Amt minor={-report.discountMinor} currency={base} />
      </Step>
      {report.taxMinor !== 0 ? (
        <Step label="الصافي قبل الضريبة" w={pct(report.netExTaxMinor)}>
          <Amt minor={report.netExTaxMinor} currency={base} />
        </Step>
      ) : null}
      {report.taxMinor !== 0 ? (
        <Step label="الضريبة" s={pct(report.netExTaxMinor)} w={pct(Math.abs(report.taxMinor))}>
          <Amt minor={report.taxMinor} currency={base} />
        </Step>
      ) : null}
      <Step label="مجموع الفواتير" tone={hasReturns ? undefined : 'key'} w={pct(report.totalMinor)}>
        <Amt minor={report.totalMinor} currency={base} />
      </Step>
      {hasReturns ? (
        <>
          <Step
            label={`المرتجعات (${report.returns.count})`}
            tone="sub"
            s={pct(net)}
            w={pct(report.returns.totalMinor)}
          >
            <Amt minor={-report.returns.totalMinor} currency={base} />
          </Step>
          <Step label="صافي المبيعات بعد المرتجعات" tone="key" w={pct(net)}>
            <Amt minor={net} currency={base} />
          </Step>
        </>
      ) : null}
      {report.collections.count > 0 ? (
        <Step label={`دفعات من الزبائن (${report.collections.count})`} w={pct(report.collections.totalMinor)}>
          <Amt minor={report.collections.totalMinor} currency={base} />
        </Step>
      ) : null}
      <Step label="تقريب النقد" w={0}>
        <Amt minor={report.cashRoundingMinor} currency={base} zero="dash" />
      </Step>
      <Step label="الإكرامية" w={0}>
        <Amt minor={report.tipsMinor} currency={base} zero="dash" />
      </Step>
      {hasReturns ? (
        <Step
          label="المقبوض فعلاً بعد المرتجعات"
          color="var(--color-chart-2)"
          w={pct(methodsBase - report.returns.totalMinor)}
        >
          <Amt minor={methodsBase - report.returns.totalMinor} currency={base} />
        </Step>
      ) : null}
    </dl>
  );
}

/** A percentage in the store's digits: one decimal under 10 %, none above */
function percent(value: number, digits: ReturnType<typeof useDigits>): string {
  const text = value < 10 && value > 0 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${displayNumber(text, digits)}%`;
}

/** The people (cashiers or sellers) as columns: a name, what they sold, their invoices and a share bar */
function PeopleCols({
  title,
  rows,
  base,
  total,
  invoices,
}: {
  title: string;
  rows: readonly CashierRow[];
  base: CurrencyCode;
  total: number;
  invoices: number;
}) {
  const digits = useDigits();
  return (
    <Panel
      title={title}
      className="sx-c12"
      aside={
        <span className="sx-n">
          {displayNumber(String(invoices), digits)} فاتورة · <Amt minor={total} currency={base} />
        </span>
      }
    >
      <div className="sx-cash3">
        {rows.map((row) => (
          <div key={row.userId}>
            <span className="sx-mute">{row.fullName}</span>
            <span className="v">
              <Amt minor={row.totalMinor} currency={base} />
            </span>
            <span className="sx-sub">{displayNumber(String(row.invoiceCount), digits)} فاتورة</span>
            <Track w={share(row.totalMinor, total)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DayReportBody({ report }: { report: DayReport }) {
  const digits = useDigits();
  const base = report.baseCurrency;
  // The headline and the average are net of the day's returns, the same figures as the home page;
  // the invoices' total and the returns sit under them
  const net =
    typeof report.netSalesMinor === 'number'
      ? report.netSalesMinor
      : report.totalMinor - (report.returns?.totalMinor ?? 0);
  const average = report.invoiceCount > 0 ? Math.round(net / report.invoiceCount) : 0;
  const methodsBase = report.byMethod.reduce((sum, row) => sum + row.baseAmountMinor, 0);
  // What the payments add up to against the invoices: cash rounding and tips ride on the payments
  const methodsGap = methodsBase - report.totalMinor;
  const cashierInvoices = report.byCashier.reduce((sum, row) => sum + row.invoiceCount, 0);
  const cashierTotal = report.byCashier.reduce((sum, row) => sum + row.totalMinor, 0);
  const sellers = report.bySalesperson ?? [];

  const methods = [...report.byMethod]
    .filter((row) => row.baseAmountMinor > 0)
    .sort((a, b) => b.baseAmountMinor - a.baseAmountMinor);
  const usd = report.byMethod.find((row) => row.method === 'cash' && row.currency === 'USD');
  const methodItems: BarItem[] = methods.map((row, index) => ({
    key: `${row.method}-${row.currency}`,
    name: methodLabel(row.method, row.currency, base),
    small: `${displayNumber(String(row.count), digits)} دفعة`,
    value: <Amt minor={row.amountMinor} currency={row.currency} />,
    extra: percent((row.baseAmountMinor / methodsBase) * 100, digits),
    w: share(row.baseAmountMinor, methodsBase),
    color: SERIES[index] ?? SERIES[3],
  }));

  const categories = (report.byCategory ?? []).filter((row) => row.totalMinor > 0 || row.lineCount > 0);
  const hasCategories = (report.byCategory ?? []).some((row) => row.categoryId !== null);
  const topMax = Math.max(...report.topProducts.map((row) => row.totalMinor), 1);
  const categoryMax = Math.max(...categories.map((row) => row.totalMinor), 1);

  return (
    <>
      <div className="sx-grid">
        <Hero
          label={report.returns.count > 0 ? 'صافي المبيعات بعد المرتجعات' : 'المبيعات'}
          net={net}
          before={report.returns.count > 0 ? report.totalMinor : null}
          returnsCount={report.returns.count}
          usdCash={usd ? { minor: usd.amountMinor, currency: usd.currency } : null}
          base={base}
        />
        <Kpis count={report.invoiceCount} average={average} returns={report.returns.totalMinor} base={base} />

        <Panel title="من المبيعات إلى الصافي" className="sx-c7">
          <Waterfall report={report} methodsBase={methodsBase} />
          <p className="sx-note">
            <InfoIcon size={16} />
            <span>الدولار محسوب بسعر كل فاتورة. البطاقة وشام كاش تُطابقان مع الكشف، لا مع الدرج.</span>
          </p>
        </Panel>

        <Panel title="حسب طريقة الدفع" className="sx-c5" fill>
          <Stack
            label="حصة طرق الدفع من المبيعات بالعملة الأساسية"
            parts={methods.map((row, index) => ({
              key: `${row.method}-${row.currency}`,
              w: share(row.baseAmountMinor, methodsBase),
              color: SERIES[index] ?? SERIES[3] ?? '',
            }))}
          />
          <BarList items={methodItems} label="المبيعات حسب طريقة الدفع والعملة" />
          {methodsGap !== 0 ? (
            <p className="sx-note tight">
              <InfoIcon size={16} />
              <span>
                مجموع الدفعات يختلف عن مجموع الفواتير بـ <Amt minor={methodsGap} currency={base} />: تقريب
                النقد <Amt minor={report.cashRoundingMinor} currency={base} /> والإكرامية{' '}
                <Amt minor={report.tipsMinor} currency={base} />
                {methodsGap - report.cashRoundingMinor - report.tipsMinor !== 0 ? (
                  <>
                    ، والباقي{' '}
                    <Amt minor={methodsGap - report.cashRoundingMinor - report.tipsMinor} currency={base} />{' '}
                    بيع بالدين أو دفعة لم تُحسب
                  </>
                ) : null}
                .
              </span>
            </p>
          ) : null}
          <div className="sx-total push">
            <span>مجموع الدفعات</span>
            <Amt minor={methodsBase} currency={base} />
          </div>
        </Panel>

        {report.topProducts.length > 0 ? (
          <Panel title="الأكثر مبيعاً" className={hasCategories ? 'sx-c7' : 'sx-c12'}>
            <BarList
              label="الأصناف الأكثر مبيعاً"
              color="var(--color-chart-1)"
              items={report.topProducts.slice(0, 8).map((row) => ({
                key: row.productId,
                name: row.name,
                small: `الكمية ${formatQuantity(row.qty)}`,
                value: <Amt minor={row.totalMinor} currency={base} />,
                w: share(row.totalMinor, topMax),
              }))}
            />
          </Panel>
        ) : null}
        {/* Nothing is filed under a department: one «بلا تصنيف» row says nothing, so it is left out */}
        {hasCategories ? (
          <Panel title="حسب القسم" className={report.topProducts.length > 0 ? 'sx-c5' : 'sx-c12'}>
            <BarList
              label="المبيعات حسب القسم"
              color="var(--color-chart-2)"
              items={categories.map((row) => ({
                key: row.categoryId ?? 'none',
                name: row.name,
                small: `${displayNumber(String(row.lineCount), digits)} أسطر`,
                value: <Amt minor={row.totalMinor} currency={base} />,
                extra:
                  row.discountMinor > 0 ? (
                    <>
                      حسم <Amt minor={row.discountMinor} currency={base} />
                    </>
                  ) : undefined,
                w: share(row.totalMinor, categoryMax),
              }))}
            />
          </Panel>
        ) : null}

        <PeopleCols
          title="حسب الكاشير"
          rows={report.byCashier}
          base={base}
          total={cashierTotal}
          invoices={cashierInvoices}
        />
        {sellers.some(
          (s) => !report.byCashier.some((c) => c.userId === s.userId && c.totalMinor === s.totalMinor),
        ) ? (
          <PeopleCols
            title="حسب البائع"
            rows={sellers}
            base={base}
            total={sellers.reduce((sum, row) => sum + row.totalMinor, 0)}
            invoices={sellers.reduce((sum, row) => sum + row.invoiceCount, 0)}
          />
        ) : null}
      </div>
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
                <Amt minor={row.amountMinor} currency={row.currency} />
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
                <Amt minor={row.totalMinor} currency={base} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The totals of a range of days: net of the returns, the invoices, the average and the returns, then one row per day */
function RangeBody({
  items,
  base,
  onPickDay,
}: {
  items: readonly DayTotal[];
  base: CurrencyCode;
  onPickDay: (day: string) => void;
}) {
  const digits = useDigits();
  const invoices = items.reduce((sum, d) => sum + d.invoiceCount, 0);
  const total = items.reduce((sum, d) => sum + d.totalMinor, 0);
  const returns = items.reduce((sum, d) => sum + d.returnsMinor, 0);
  const net = total - returns;
  const average = invoices > 0 ? Math.round(net / invoices) : 0;
  return (
    <>
      <div className="sx-grid">
        <Hero
          label={returns > 0 ? 'صافي المبيعات بعد المرتجعات' : 'المبيعات'}
          net={net}
          before={returns > 0 ? total : null}
          returnsCount={0}
          usdCash={null}
          base={base}
        />
        <Kpis count={invoices} average={average} returns={returns} base={base} />
      </div>
      <Panel title="يوم بيوم" flush>
        <SxTable
          bare
          caption="مبيعات كل يوم في المدة"
          rows={[...items]}
          rowKey={(row) => row.date}
          columns={[
            {
              key: 'day',
              header: 'اليوم',
              cell: (row) => (
                <button type="button" className="sx-rowbtn min-h-11" onClick={() => onPickDay(row.date)}>
                  {dayText(row.date, digits)}
                </button>
              ),
              total: 'المجموع',
            },
            {
              key: 'count',
              header: 'الفواتير',
              numeric: true,
              cell: (row) => <span className="sx-n">{displayNumber(String(row.invoiceCount), digits)}</span>,
              total: <span className="sx-n">{displayNumber(String(invoices), digits)}</span>,
            },
            {
              key: 'total',
              header: 'المبيعات',
              numeric: true,
              cell: (row) => <Amt minor={row.totalMinor} currency={base} />,
              total: <Amt minor={total} currency={base} />,
            },
            {
              key: 'returns',
              header: 'المرتجعات',
              numeric: true,
              cell: (row) => <Amt minor={row.returnsMinor} currency={base} />,
              total: <Amt minor={returns} currency={base} />,
            },
            {
              key: 'net',
              header: 'الصافي',
              numeric: true,
              strong: true,
              cell: (row) => <Amt minor={row.totalMinor - row.returnsMinor} currency={base} />,
              total: <Amt minor={net} currency={base} />,
            },
          ]}
        />
      </Panel>
      <p className="sx-note print:hidden">
        <InfoIcon size={16} />
        <span>لتفصيل يوم بعينه (طرق الدفع والكاشير والأصناف) اضغط على اليوم في الجدول.</span>
      </p>
    </>
  );
}

/**
 * «مبيعات اليوم» (19 › تقرير اليوم; admin/Home › مبيعات اليوم, admin/Reports › العارض): the day's
 * invoices, discounts, tax, rounding and tips for a branch or all of them, by payment method and
 * currency and by cashier, with an A4 print. The chips «اليوم / أمس / هالأسبوع / هالشهر» and the
 * arrows move the day; a week or a month shows the totals of the range with a row per day.
 */
export function DayReportPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const base = me.settings.baseCurrency;
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [range, setRange] = useState<DayRange>({ from: today, to: today });
  const single = range.from === range.to;
  const date = range.from;
  const { data, error, loading, retry } = useReport(single ? `${branchId ?? ''}|${date}` : null, () =>
    getDayReport({ branchId, date }),
  );
  const rangeState = useReport(single ? null : `range|${branchId ?? ''}|${range.from}|${range.to}`, () =>
    getDayTotals({ from: range.from, to: range.to, branchId }),
  );
  // An empty day: the latest day before it that had sales (within the last two months)
  const empty = single && data !== null && data.invoiceCount === 0;
  const lastSales = useReport(empty ? `last|${branchId ?? ''}|${date}` : null, () =>
    getDayTotals({ from: addDays(date, -61), to: addDays(date, -1), branchId }),
  );
  const lastDay = [...(lastSales.data?.items ?? [])].reverse().find((d) => d.invoiceCount > 0)?.date;
  const { paper, print } = usePrint();
  const where = branchName(me, branchId);
  const title = single
    ? `${where} · ${dayText(date, digits)}`
    : `${where} · من ${dayText(range.from, digits)} إلى ${dayText(range.to, digits)}`;
  const isToday = single && date === today;
  // After midnight a shift opened yesterday may still be open: its invoices are yesterday's
  const { note: openShift } = useOpenShiftFromYesterday(
    isToday,
    today,
    me.tenant.timezone,
    undefined,
    branchId,
  );
  const pickDay = (day: string) => setRange({ from: day, to: day });

  return (
    <ReportScreen me={me} access={DAY_REPORT_ACCESS} title="مبيعات اليوم">
      <SalesPage>
        <PageTop
          title={isToday ? 'مبيعات اليوم' : single ? 'مبيعات يوم' : 'مبيعات مدة'}
          subtitle={title}
          actions={
            <Button
              variant="ghost"
              icon={<PrintIcon />}
              disabled={!data || !single}
              onClick={() => print('A4')}
            >
              اطبع
            </Button>
          }
        />

        <div className="sx-toolbar print:hidden">
          {single ? (
            <DayStepper date={date} today={today} onPick={pickDay} />
          ) : (
            <>
              <DayField
                label="من"
                value={range.from}
                max={range.to}
                onChange={(day) => setRange({ from: day, to: range.to })}
              />
              <DayField
                label="إلى"
                value={range.to}
                max={today}
                onChange={(day) => setRange({ from: range.from <= day ? range.from : day, to: day })}
              />
            </>
          )}
          <PeriodChips
            name="day-period"
            range={range}
            today={today}
            scroll
            onPick={(next) => setRange(next)}
          />
          <div className="sx-push">
            <BranchSelect me={me} value={branchId} onChange={setBranchId} hideLabel className="min-w-44" />
          </div>
        </div>

        {openShift ? (
          <Alert tone="info">
            وردية مفتوحة منذ أمس: {displayNumber(String(openShift.count), digits)} فاتورة بمبلغ{' '}
            <Amt minor={openShift.netMinor} currency={base} className="font-semibold" />. فواتيرها بتاريخ أمس،
            فلا تظهر في أرقام اليوم.
          </Alert>
        ) : null}

        {single && loading ? <ReportLoading label="نحمّل مبيعات اليوم…" /> : null}
        {single && error ? <ReportError message={error} onRetry={retry} /> : null}
        {!single && rangeState.loading ? <ReportLoading label="نحمّل مبيعات المدة…" /> : null}
        {!single && rangeState.error ? (
          <ReportError message={rangeState.error} onRetry={rangeState.retry} />
        ) : null}
        {single && data && data.invoiceCount === 0 ? (
          <Card>
            <EmptyState
              icon={SalesIcon}
              title={isToday ? 'لا مبيعات اليوم بعد.' : 'لا مبيعات في هذا اليوم.'}
              description={
                isToday
                  ? 'تظهر هنا فواتير اليوم لحظة وصولها من أجهزة الكاشير.'
                  : 'اختر يوماً آخر أو فرعاً آخر.'
              }
              action={
                lastDay ? (
                  <Button variant="secondary" onClick={() => pickDay(lastDay)}>
                    آخر يوم فيه مبيعات: {dayText(lastDay, digits)}
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : null}
        {single && data && data.invoiceCount > 0 ? <DayReportBody report={data} /> : null}
        {!single && rangeState.data ? (
          rangeState.data.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={SalesIcon}
                title="لا مبيعات في هذه المدة."
                description="اختر مدة أخرى أو فرعاً آخر."
              />
            </Card>
          ) : (
            <RangeBody items={rangeState.data.items} base={base} onPickDay={pickDay} />
          )
        ) : null}

        {data && paper && single ? (
          <PrintSheet paper={paper}>
            <DayReportSheet report={data} me={me} title={title} />
          </PrintSheet>
        ) : null}
      </SalesPage>
    </ReportScreen>
  );
}
