import { useState } from 'react';
import {
  SALES_GROUP_LABEL,
  SALES_GROUPS,
  type SalesBreakdown,
  type SalesBreakdownRow,
  type SalesGroup,
} from '@serva/core';
import {
  Badge,
  Button,
  Card,
  DataTable,
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
import { isoDay, monthStart } from '../../lib/dates';
import { csvField, downloadText, minorToDecimal } from '../accounting/csv';
import { apiFetch } from '../../lib/api';
import { commissionOf } from './MerchandisePage';
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
    const c = commissionOf(r.totalMinor + r.returnedMinor, r.returnedMinor, commission);
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
  const [by, setBy] = useState<SalesGroup>('product');
  const [option, setOption] = useState('');
  const [commission, setCommission] = useState('');
  const { data, error, loading, retry } = useReport(`${from}|${to}|${by}|${option}`, () =>
    getSalesBreakdown({ from, to, by, option }),
  );
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const needsOption = by === 'option' && !option;

  const columns: DataColumn<SalesBreakdownRow>[] = [
    {
      key: 'name',
      header: SALES_GROUP_LABEL[by],
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (r) => formatQuantity(r.qty) },
    {
      key: 'total',
      header: 'المبيع بعد المرتجع',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={base} className="font-semibold" />,
    },
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
        return (
          <Badge tone={change >= 0 ? 'success' : 'warning'}>{`${change > 0 ? '+' : ''}${change}٪`}</Badge>
        );
      },
    },
    ...(by === 'seller'
      ? [
          {
            key: 'commission',
            header: 'العمولة',
            numeric: true,
            cell: (r: SalesBreakdownRow) => {
              const c = commissionOf(r.totalMinor + r.returnedMinor, r.returnedMinor, commission);
              return c === null ? '—' : <Money minor={c} currency={base} className="font-bold" />;
            },
          } satisfies DataColumn<SalesBreakdownRow>,
        ]
      : []),
  ];

  return (
    <ReportScreen me={me} access={['report.view']} title="تقرير المبيعات">
      <PageHeader
        title="تقرير المبيعات"
        description="ما بيع في المدة، مجمّعاً كما تشاء، مقارناً بالمدة السابقة المساوية لها."
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
            صدّر CSV
          </Button>
        }
      />
      <ReportFilters>
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
        <SegmentedControl
          label="التجميع"
          options={SALES_GROUPS.map((g) => ({ value: g, label: SALES_GROUP_LABEL[g] }))}
          value={by}
          onValueChange={setBy}
        />
        {by === 'option' ? (
          <Select label="الخيار" value={option} onChange={(e) => setOption(e.target.value)}>
            <option value="">اختر الخيار</option>
            {(data?.optionNames ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : null}
        {by === 'seller' ? (
          <TextField
            label="نسبة العمولة ٪"
            hint="تُحسب على المبيع بعد المرتجع"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="مبيع المدة" value={<Money minor={data.totalMinor} currency={base} />} />
            <StatTile
              label="المدة السابقة"
              value={<Money minor={data.previousTotalMinor} currency={base} />}
              footnote={`${data.previousFrom} إلى ${data.previousTo}`}
            />
          </div>
          <DataTable
            caption="المبيعات"
            columns={columns}
            rows={data.rows}
            rowKey={(r) => r.key}
            loading={loading}
            empty={<p className="p-4 text-ink-muted">لا مبيعات في هذه المدة.</p>}
          />
        </>
      ) : null}
    </ReportScreen>
  );
}
