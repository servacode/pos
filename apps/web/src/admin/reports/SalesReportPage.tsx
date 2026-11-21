import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  formatMoney,
  getCurrency,
  SALES_GROUP_LABEL,
  SALES_GROUPS,
  type SalesBreakdown,
  type SalesBreakdownRow,
  type SalesCross,
  type SalesGroup,
} from '@serva/core';
import {
  Badge,
  BarChart,
  Button,
  Card,
  DataTable,
  compactNumber,
  formatQuantity,
  Money,
  PageHeader,
  ReportsIcon,
  SegmentedControl,
  Select,
  StatTile,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, monthStart } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { storeSells } from '../../lib/sectors';
import { csvField, downloadText, minorToDecimal } from '../accounting/csv';
import { apiFetch } from '../../lib/api';
import { commissionOf } from './MerchandisePage';
import { orderValues } from '../../lib/optionOrder';
import { DayField, ReportFilters, ReportScreen } from './parts';
import { useReport } from './useReport';

/** `GET /v1/reports/sales-breakdown` (report.view) */
export const getSalesBreakdown = (q: { from: string; to: string; by: SalesGroup; option?: string }) => {
  const params = new URLSearchParams({ from: q.from, to: q.to, by: q.by });
  if (q.by === 'option' && q.option) params.set('option', q.option);
  return apiFetch<SalesBreakdown>(`/v1/reports/sales-breakdown?${params.toString()}`, { auth: true });
};

/** The change against the previous period, as a signed percent; null when there was nothing before. */
export function changePercent(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * How a change reads without shouting: a doubling or more is «أكثر من الضعف» rather than «+340%», and
 * a fall to nothing is «لا مبيع» rather than «−100%»; the rest is the plain percent.
 */
export function softChange(change: number): { text: string; tone: 'success' | 'neutral' | 'warning' } {
  if (change > 100) return { text: 'أكثر من الضعف', tone: 'success' };
  if (change <= -100) return { text: 'لا مبيع', tone: 'neutral' };
  if (change <= -75) return { text: 'انخفاض كبير', tone: 'warning' };
  const text = `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}٪`;
  return { text, tone: change >= 0 ? 'success' : change <= -50 ? 'warning' : 'neutral' };
}

/**
 * Every day of the period for the bars, a day with no sale as zero, so a quiet day is a short gap and
 * not missing. A very long period keeps only the days that sold (a bar per day would be unreadable).
 */
export function everyDay(
  from: string,
  to: string,
  daily: readonly { date: string; totalMinor: number }[],
): { date: string; totalMinor: number }[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000) + 1;
  if (!(days > 0) || days > 62) return [...daily];
  const by = new Map(daily.map((d) => [d.date, d.totalMinor]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    return { date, totalMinor: by.get(date) ?? 0 };
  });
}

/** A season's sell-through: sold as a share of what was received; null when nothing was received */
export function sellThrough(sold: number, received: number | null | undefined): number | null {
  if (!received || received <= 0) return null;
  return Math.max(0, Math.round((sold / received) * 100));
}

/**
 * A seller's commission: the rate of the staff page when the seller has one (the server worked it
 * out), else the percent typed here as a fallback.
 */
export function commissionFor(r: SalesBreakdownRow, typedPercent: string): number | null {
  if (r.commissionMinor !== null && r.commissionMinor !== undefined) return r.commissionMinor;
  return commissionOf(r.totalMinor + r.returnedMinor, r.returnedMinor, typedPercent);
}

/** The report as CSV for Excel: each row with the previous period beside it. */
export function salesBreakdownCsv(s: SalesBreakdown, commission: string): string {
  const n = (minor: number) => csvField(minorToDecimal(minor, s.baseCurrency), true);
  const head = [
    SALES_GROUP_LABEL[s.by],
    'الكمية',
    'الفواتير',
    `المبيع ${s.from} إلى ${s.to}`,
    'رجع منه',
    `المبيع ${s.previousFrom} إلى ${s.previousTo}`,
    'التغيّر ٪',
    ...(s.by === 'seller' ? ['العمولة'] : []),
  ].map((h) => csvField(h));
  const lines = s.rows.map((r) => {
    const change = changePercent(r.totalMinor, r.previousTotalMinor);
    const c = commissionFor(r, commission);
    return [
      csvField(r.name),
      csvField(String(r.qty / 1000), true),
      csvField(String(r.invoiceCount), true),
      n(r.totalMinor),
      n(r.returnedMinor),
      n(r.previousTotalMinor),
      csvField(change === null ? '' : String(change), true),
      ...(s.by === 'seller' ? [c === null ? csvField('') : n(c)] : []),
    ];
  });
  return `\uFEFF${[head, ...lines].map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}

/** Pieces sold across two options (size down, colour across), with row and column totals */
export function CrossTable({ cross }: { cross: SalesCross }) {
  // Each option's values in the order its own list defines (S M L XL, 30 32 34…), grouped by kind
  const rowValues = orderValues(
    cross.rowOption,
    cross.cells.map((c) => c.row),
  );
  const colValues = orderValues(
    cross.colOption,
    cross.cells.map((c) => c.col),
  );
  const rows = rowValues.map((v) => v.value);
  const cols = colValues.map((v) => v.value);
  const colGroups = colValues.reduce<{ label: string | null; span: number }[]>((out, v) => {
    const last = out[out.length - 1];
    if (last && last.label === v.group) last.span += 1;
    else out.push({ label: v.group, span: 1 });
    return out;
  }, []);
  const grouped = colGroups.some((g) => g.label !== null);
  const at = (row: string, col: string) => cross.cells.find((c) => c.row === row && c.col === col)?.qty ?? 0;
  const rowTotal = (row: string) => cols.reduce((n, col) => n + at(row, col), 0);
  const colTotal = (col: string) => rows.reduce((n, row) => n + at(row, col), 0);
  const cell = (qty: number) => (qty === 0 ? '·' : formatQuantity(qty));
  if (rows.length === 0)
    return (
      <Card>
        <p className="text-ink-muted">لا مبيعات بخيارين في هذه المدة.</p>
      </Card>
    );
  return (
    <Card className="overflow-x-auto !p-0">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{`القطع المباعة بحسب ${cross.rowOption} و${cross.colOption}`}</caption>
        <thead>
          {grouped ? (
            <tr className="bg-surface-muted text-xs text-ink-muted">
              <td />
              {colGroups.map((g, i) => (
                <th key={i} colSpan={g.span} scope="colgroup" className="px-3 pt-2 text-center font-semibold">
                  {g.label ?? ''}
                </th>
              ))}
              <td />
            </tr>
          ) : null}
          <tr className="border-b border-line bg-surface-muted text-ink-muted">
            <th scope="col" className="px-3 py-2 text-start font-semibold">
              {`${cross.rowOption} / ${cross.colOption}`}
            </th>
            {cols.map((col) => (
              <th key={col} scope="col" className="px-3 py-2 text-center font-semibold">
                {col}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-center font-bold text-ink">
              المجموع
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row} className="border-b border-line last:border-0">
              <th scope="row" className="px-3 py-2 text-start font-semibold">
                {row}
              </th>
              {cols.map((col) => (
                <td key={col} className="num px-3 py-2 text-center">
                  {cell(at(row, col))}
                </td>
              ))}
              <td className="num px-3 py-2 text-center font-bold">{cell(rowTotal(row))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface-muted font-bold">
            <th scope="row" className="px-3 py-2 text-start">
              المجموع
            </th>
            {cols.map((col) => (
              <td key={col} className="num px-3 py-2 text-center">
                {cell(colTotal(col))}
              </td>
            ))}
            <td className="num px-3 py-2 text-center">
              {cell(cols.reduce((n, col) => n + colTotal(col), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/**
 * «تقرير المبيعات»: what sold in a period by product, category, option (size, colour) or seller,
 * net of returns, against the period of the same length before, with the seller's commission at a
 * percent typed here, and a CSV for Excel.
 */
export function SalesReportPage() {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [params] = useSearchParams();
  const asked = params.get('by');
  const [by, setBy] = useState<SalesGroup>(
    (SALES_GROUPS as readonly string[]).includes(asked ?? '') ? (asked as SalesGroup) : 'product',
  );
  const [option, setOption] = useState('');
  const [commission, setCommission] = useState('');
  const [view, setView] = useState<'list' | 'cross'>('list');
  const { data, error, loading, retry } = useReport(
    by === 'option' && !option ? null : `${from}|${to}|${by}|${option}`,
    () => getSalesBreakdown({ from, to, by, option }),
    { cache: 'sales-breakdown' },
  );
  // The option names (المقاس، اللون…) come with any other grouping: asking by option without a name is refused
  const [optionNames, setOptionNames] = useState<string[]>([]);
  useEffect(() => {
    if (by !== 'option' || optionNames.length > 0) return;
    let current = true;
    getSalesBreakdown({ from, to, by: 'product' }).then(
      (r) => {
        if (!current) return;
        setOptionNames(r.optionNames);
        setOption((o) => o || r.optionNames[0] || '');
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [by, from, to, optionNames.length]);
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const needsOption = by === 'option' && !option;
  const noOptions = data !== null && data.optionNames.length === 0;
  const days = data ? everyDay(data.from, data.to, data.daily ?? []) : [];
  // Grouped by an option, the rows hold only the lines that have it; the headline stays the whole
  // period's sales (the days add up to it) and says how much of it carries the option
  const headline =
    data && data.by === 'option' && (data.daily?.length ?? 0) > 0
      ? (data.daily ?? []).reduce((n, d) => n + d.totalMinor, 0)
      : (data?.totalMinor ?? 0);
  // A shop of clothes names sizes and colours; any other shop just picks one of its options
  // Seasons are a clothing idea: other shops do not see the tab
  const sellsSeasons = storeSells(me.tenant.sectors, ['clothing']);
  const groupLabel = (g: SalesGroup): string =>
    g === 'option' && !storeSells(me.tenant.sectors, ['clothing'])
      ? 'الخيار (النوع، الحجم…)'
      : SALES_GROUP_LABEL[g];
  // No history before this period: the previous-period columns would be a column of zeros and «جديد»
  const hasHistory =
    (data?.previousTotalMinor ?? 0) > 0 || (data?.rows ?? []).some((r) => r.previousTotalMinor > 0);

  const historyColumns: DataColumn<SalesBreakdownRow>[] = [
    {
      key: 'previous',
      header: 'الفترة السابقة',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (r) => <Money minor={r.previousTotalMinor} currency={base} />,
    },
    {
      key: 'change',
      header: 'التغيّر',
      cell: (r) => {
        const change = changePercent(r.totalMinor, r.previousTotalMinor);
        if (change === null) return r.totalMinor > 0 ? <Badge tone="info">جديد</Badge> : '—';
        // A base too small to compare with (under a tenth of the whole previous period) says nothing
        if (data && r.previousTotalMinor * 10 < data.previousTotalMinor) return '—';
        const soft = softChange(change);
        return (
          <Badge tone={soft.tone}>
            <bdi dir="ltr" className="num">
              {soft.text}
            </bdi>
          </Badge>
        );
      },
    },
  ];
  // A season's sell-through: what sold, out of what was received, once the shop has bought for it
  const seasonColumns: DataColumn<SalesBreakdownRow>[] = [
    {
      key: 'received',
      header: 'المستلم',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (r) => (r.receivedQty ? formatQuantity(r.receivedQty) : '—'),
    },
    {
      key: 'through',
      header: 'نسبة البيع',
      numeric: true,
      cell: (r) => {
        const through = sellThrough(r.qty, r.receivedQty);
        return through === null ? (
          '—'
        ) : (
          <Badge tone={through >= 70 ? 'success' : through >= 35 ? 'info' : 'neutral'}>
            <bdi dir="ltr" className="num">{`${formatNumber(through)}٪`}</bdi>
          </Badge>
        );
      },
    },
  ];
  const sellerColumns: DataColumn<SalesBreakdownRow>[] = [
    {
      key: 'commission',
      header: 'العمولة',
      numeric: true,
      cell: (r) => {
        const c = commissionFor(r, commission);
        return c === null ? '—' : <Money minor={c} currency={base} className="font-bold" />;
      },
    },
  ];

  const columns: DataColumn<SalesBreakdownRow>[] = [
    {
      key: 'name',
      header: groupLabel(by),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.name}</span>
          {r.qty < 0 ? <Badge tone="warning">مرتجع بلا بيع في المدة</Badge> : null}
        </span>
      ),
    },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => formatQuantity(r.qty) },
    {
      key: 'total',
      header: 'المبيع بعد المرتجع',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={base} className="font-semibold" />,
    },
    ...(by === 'season' ? seasonColumns : []),
    ...(hasHistory ? historyColumns : []),
    ...(by === 'seller' ? sellerColumns : []),
  ];
  return (
    <ReportScreen me={me} access={['report.view']} title="تقرير المبيعات">
      <PageHeader
        title="تقرير المبيعات"
        description={
          hasHistory
            ? 'ما بيع في المدة، مجمّعاً كما تشاء، مقارناً بالمدة السابقة المساوية لها.'
            : 'ما بيع في المدة، مجمّعاً كما تشاء. لا مبيع قبلها للمقارنة.'
        }
        icon={<ReportsIcon />}
        actions={
          <Button
            variant="secondary"
            disabled={!data}
            onClick={() =>
              data &&
              downloadText(
                `تقرير-المبيعات-${data.by}-${data.from}-${data.to}.csv`,
                salesBreakdownCsv(data, commission),
              )
            }
          >
            صدّر إلى إكسل
          </Button>
        }
      />
      <ReportFilters>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="مدة جاهزة">
          {(
            [
              ['آخر 7 أيام', 6],
              ['آخر 30 يوماً', 29],
            ] as const
          ).map(([label, back]) => (
            <Button
              key={label}
              size="xs"
              variant="secondary"
              onClick={() => {
                setFrom(isoDay(Date.now() - back * 86_400_000, me.tenant.timezone));
                setTo(today);
              }}
            >
              {label}
            </Button>
          ))}
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setFrom(monthStart(today));
              setTo(today);
            }}
          >
            هذا الشهر
          </Button>
        </div>
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
        <div className="max-w-full min-w-0 overflow-x-auto">
          <SegmentedControl
            label="التجميع"
            options={SALES_GROUPS.filter(
              (g) =>
                (g !== 'season' || sellsSeasons || by === 'season') &&
                // A store whose pieces have no options (size, colour…) has nothing to group by them
                (g !== 'option' || by === 'option' || !noOptions),
            ).map((g) => ({ value: g, label: groupLabel(g) }))}
            value={by}
            onValueChange={setBy}
          />
        </div>
        {by === 'option' ? (
          <Select label="الخيار" value={option} onChange={(e) => setOption(e.target.value)}>
            <option value="">اختر الخيار</option>
            {(data?.optionNames?.length ? data.optionNames : optionNames).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : null}
        {by === 'seller' ? (
          <TextField
            label="نسبة العمولة ٪"
            hint="تُستعمل لمن لم تحدّد له نسبة في صفحة الموظفين، وتُحسب على المبيع بعد المرتجع"
            inputMode="decimal"
            dir="ltr"
            value={commission}
            onChange={(e) => setCommission(e.target.value.slice(0, 6))}
            className="w-36"
          />
        ) : null}
      </ReportFilters>
      {error ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-ink">{error}</p>
          <Button variant="secondary" onClick={retry}>
            حاول مرة أخرى
          </Button>
        </Card>
      ) : null}
      {needsOption && !data ? (
        <Card>
          <p className="text-ink-muted">اختر الخيار الذي تريد تجميع المبيعات به، مثل المقاس أو اللون.</p>
        </Card>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile
              label="إجمالي المبيعات (بعد المرتجع، مع الضريبة)"
              value={<Money minor={headline} currency={base} />}
              footnote={
                headline !== data.totalMinor ? (
                  <>
                    منها بخيارات <Money minor={data.totalMinor} currency={base} />
                  </>
                ) : undefined
              }
            />
            {hasHistory ? (
              <StatTile
                label="المدة السابقة"
                value={<Money minor={data.previousTotalMinor} currency={base} />}
                footnote={`${dayText(data.previousFrom)} إلى ${dayText(data.previousTo)}`}
              />
            ) : null}
            {data.by === 'seller' ? (
              <StatTile
                label="عمولات البائعين"
                value={
                  <Money
                    minor={data.rows.reduce((n, r) => n + (commissionFor(r, commission) ?? 0), 0)}
                    currency={base}
                  />
                }
                footnote="بنسب صفحة الموظفين"
              />
            ) : null}
          </div>
          {(data.daily?.length ?? 0) >= 3 ? (
            <Card className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-ink">المبيع كل يوم</h2>
              <BarChart
                label="المبيع كل يوم بعد المرتجع"
                labels={days.map((d) => dayText(d.date, me.settings.numberFormat))}
                axisLabels={days.map((d) => d.date.slice(8).replace(/^0/, ''))}
                series={[
                  {
                    key: 'sales',
                    label: 'المبيع',
                    values: days.map((d) => d.totalMinor / 10 ** getCurrency(base).decimals),
                  },
                ]}
                valueLabels={false}
                height={120}
                formatValue={(value) =>
                  formatMoney(Math.round(value * 10 ** getCurrency(base).decimals), base, {
                    digits: me.settings.numberFormat,
                  })
                }
                formatTick={(value) => compactNumber(value, me.settings.numberFormat)}
                labelHeader="اليوم"
              />
              <p className="text-xs text-ink-muted">
                الأرقام تحت الأعمدة هي أيام الشهر، من {dayText(data.from)} إلى {dayText(data.to)}.
              </p>
            </Card>
          ) : (
            <p className="text-sm text-ink-muted">يظهر الرسم بعد 3 أيام فيها مبيعات.</p>
          )}
          {hasHistory ? (
            <p className="text-sm text-ink-muted">
              مقارنة بـ {dayText(data.previousFrom)} إلى {dayText(data.previousTo)}.
            </p>
          ) : null}
          {by === 'option' && data.cross ? (
            <SegmentedControl
              label="طريقة العرض"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'list', label: 'قائمة' },
                { value: 'cross', label: `${data.cross.rowOption} × ${data.cross.colOption}` },
              ]}
            />
          ) : null}
          {by === 'option' && data.cross && view === 'cross' ? (
            <CrossTable cross={data.cross} />
          ) : (
            <DataTable
              caption="المبيعات"
              columns={columns}
              rows={data.rows}
              rowKey={(r) => r.key}
              loading={loading}
              empty={<p className="p-4 text-ink-muted">لا مبيعات في هذه المدة.</p>}
            />
          )}
        </>
      ) : null}
    </ReportScreen>
  );
}
