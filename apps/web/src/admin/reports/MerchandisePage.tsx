import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Category, MerchandiseReport, OptionSales } from '@serva/core';
import {
  Alert,
  Badge,
  DataTable,
  formatQuantity,
  Money,
  SegmentedControl,
  Select,
  StatTile,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { listCategories } from '../catalog/api';

type Slow = MerchandiseReport['slowMovers'][number];
type Piece = MerchandiseReport['models'][number]['pieces'][number];

const PERIODS = { '30': 'آخر 30 يوماً', '90': 'آخر 3 أشهر', '365': 'آخر سنة' } as const;
const IDLE = { '30': 'شهر', '60': 'شهرين', '90': '3 أشهر' } as const;

/** YYYY-MM-DD of `days` days before today, in the browser's calendar */
export function daysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
}

export const getMerchandise = (from: string, to: string, idleDays: number, categoryId = '') =>
  apiFetch<MerchandiseReport>(
    `/v1/reports/merchandise?from=${from}&to=${to}&idleDays=${idleDays}${categoryId ? `&categoryId=${categoryId}` : ''}`,
    { auth: true },
  );

const COMMISSION_KEY = 'serva-commission-percent';
const readCommission = () => {
  try {
    return localStorage.getItem(COMMISSION_KEY) ?? '';
  } catch {
    return '';
  }
};

/** A seller's commission: what they sold less what came back, times the percent typed. */
export function commissionOf(totalMinor: number, returnedMinor: number, percentText: string): number | null {
  const percent = Number(
    percentText.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.'),
  );
  if (!percentText.trim() || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return Math.round(((totalMinor - returnedMinor) * percent) / 100);
}

const returnRate = (r: OptionSales) =>
  r.soldQty === 0 ? null : Math.round((r.returnedQty / r.soldQty) * 100);

/**
 * «حركة الأصناف» (03 › الألبسة: المبيعات حسب المقاس واللون، والقطع الراكدة): which sizes and colours
 * sell and which come back, each model's pieces with what is left of them, and what has slept on
 * the shelf, so the next order buys what sells and the sleeping pieces go on sale.
 */
/** A department's net sales as a share of all departments', «42٪»; «—» when nothing sold */
export function shareOf(
  netMinor: number,
  all: readonly { totalMinor: number; returnedMinor: number }[],
): string {
  const total = all.reduce((n, d) => n + d.totalMinor - d.returnedMinor, 0);
  if (total <= 0) return '—';
  return `${Math.round((netMinor / total) * 100)}٪`;
}

export function MerchandisePage() {
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30');
  const [departments, setDepartments] = useState<Category[]>([]);
  const [department, setDepartment] = useState('');
  const [commission, setCommission] = useState(readCommission);
  useEffect(() => {
    listCategories()
      .then((r) => setDepartments(r.items.filter((c) => c.parentId === null && !c.archivedAt)))
      .catch(() => setDepartments([]));
  }, []);
  const [idle, setIdle] = useState<keyof typeof IDLE>('60');
  const [data, setData] = useState<MerchandiseReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    getMerchandise(daysAgo(Number(period)), daysAgo(0), Number(idle), department)
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [period, idle, department]);
  useEffect(load, [load]);

  const base = data?.baseCurrency ?? 'SYP';
  const optionColumns: DataColumn<OptionSales>[] = [
    { key: 'value', header: 'القيمة', cell: (r) => <span className="font-semibold">{r.value}</span> },
    { key: 'sold', header: 'بيع', numeric: true, cell: (r) => formatQuantity(r.soldQty) },
    { key: 'back', header: 'رجع', numeric: true, cell: (r) => formatQuantity(r.returnedQty) },
    {
      key: 'rate',
      header: 'نسبة الرجوع',
      cell: (r) => {
        const rate = returnRate(r);
        if (rate === null || rate === 0) return '—';
        return <Badge tone={rate >= 20 ? 'warning' : 'neutral'}>{rate}٪</Badge>;
      },
    },
    {
      key: 'total',
      header: 'المبيع',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={base} />,
    },
  ];
  const pieceColumns: DataColumn<Piece>[] = [
    { key: 'label', header: 'القطعة', cell: (r) => r.label || '—' },
    { key: 'sold', header: 'بيع', numeric: true, cell: (r) => formatQuantity(r.soldQty) },
    {
      key: 'stock',
      header: 'في المخزون',
      numeric: true,
      cell: (r) =>
        r.stockQty <= 0 && r.soldQty > 0 ? <Badge tone="danger">نفد</Badge> : formatQuantity(r.stockQty),
    },
  ];
  const slowColumns: DataColumn<Slow>[] = [
    {
      key: 'name',
      header: 'القطعة',
      cell: (r) => (
        <Link
          to={`/products/${r.productId}`}
          className="font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { key: 'qty', header: 'في المخزون', numeric: true, cell: (r) => formatQuantity(r.stockQty) },
    ...(data?.slowValueMinor !== null && data?.slowValueMinor !== undefined
      ? [
          {
            key: 'value',
            header: 'بكلفة',
            numeric: true,
            cell: (r: Slow) => <Money minor={r.valueMinor ?? 0} currency={base} />,
          },
        ]
      : []),
    {
      key: 'sold',
      header: 'آخر بيع',
      cell: (r) => (r.lastSoldOn ? <bdi className="num">{r.lastSoldOn}</bdi> : 'لم يُبع'),
    },
    {
      key: 'in',
      header: 'آخر وصول',
      cell: (r) => (r.lastReceivedOn ? <bdi className="num">{r.lastReceivedOn}</bdi> : '—'),
    },
  ];

  return (
    <AppShell>
      <title>حركة الأصناف · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink">حركة الأصناف</h1>
          <p className="text-ink-muted">
            ما يُباع من كل مقاس ولون وما يرجع، وما بقي من كل موديل، والقطع الراكدة على الرف.
          </p>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-wrap gap-4">
          {departments.length > 0 ? (
            <Select
              label="القسم"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-48"
            >
              <option value="">كل الأقسام</option>
              {departments.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}
          <SegmentedControl
            label="المبيعات خلال"
            value={period}
            onValueChange={setPeriod}
            options={(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((value) => ({
              value,
              label: PERIODS[value],
            }))}
          />
          <SegmentedControl
            label="راكد إن لم يُبع ولم يصل منذ"
            value={idle}
            onValueChange={setIdle}
            options={(Object.keys(IDLE) as (keyof typeof IDLE)[]).map((value) => ({
              value,
              label: IDLE[value],
            }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="قطع راكدة"
            value={<span className="num">{data ? data.slowMovers.length : '—'}</span>}
          />
          {data?.slowValueMinor !== null && data?.slowValueMinor !== undefined ? (
            <StatTile
              label="رأس مال نائم فيها"
              value={<Money minor={data.slowValueMinor} currency={base} />}
              footnote="بكلفة الشراء"
            />
          ) : null}
        </div>

        {data && data.byDepartment.length > 0 ? (
          <DataTable
            caption="المبيعات حسب القسم"
            columns={[
              {
                key: 'name',
                header: 'القسم',
                cell: (r) => <span className="font-semibold">{r.name}</span>,
              },
              {
                key: 'sold',
                header: 'القطع',
                numeric: true,
                cell: (r) => <span className="num">{r.soldQty / 1000}</span>,
              },
              {
                key: 'total',
                header: 'المبيع',
                numeric: true,
                cell: (r) => <Money minor={r.totalMinor} currency={base} />,
              },
              {
                key: 'back',
                header: 'رجع منه',
                numeric: true,
                cell: (r) => <Money minor={r.returnedMinor} currency={base} />,
              },
              {
                key: 'share',
                header: 'النصيب',
                numeric: true,
                cell: (r) => (
                  <span className="num">{shareOf(r.totalMinor - r.returnedMinor, data.byDepartment)}</span>
                ),
              },
            ]}
            rows={data.byDepartment}
            rowKey={(r) => r.categoryId ?? 'none'}
          />
        ) : null}

        {data && data.byOption.length === 0 ? (
          <Alert tone="info">
            لا مبيعات لقطع لها مقاس أو لون في هذه المدة. أضف «المقاسات والألوان» في بطاقة المنتج.
          </Alert>
        ) : null}
        {data?.byOption.map((group) => (
          <DataTable
            key={group.name}
            caption={`المبيعات حسب ${group.name}`}
            columns={optionColumns}
            rows={group.values}
            rowKey={(r) => r.value}
          />
        ))}

        {data && data.models.length > 0 ? (
          <section aria-label="الموديلات الأكثر مبيعاً" className="flex flex-col gap-4">
            <h2 className="text-xl font-bold text-ink">الموديلات الأكثر مبيعاً</h2>
            {data.models.map((m) => (
              <DataTable
                key={m.productId}
                caption={m.name}
                columns={pieceColumns}
                rows={m.pieces}
                rowKey={(r) => r.variantId}
              />
            ))}
          </section>
        ) : null}

        {data && data.bySeller.length > 0 ? (
          <section aria-label="المبيعات حسب البائع" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="flex-1 text-xl font-bold text-ink">المبيعات حسب البائع والعمولة</h2>
              <TextField
                label="نسبة العمولة ٪"
                dir="ltr"
                inputMode="decimal"
                value={commission}
                onChange={(e) => {
                  const next = e.target.value.slice(0, 6);
                  setCommission(next);
                  try {
                    localStorage.setItem(COMMISSION_KEY, next);
                  } catch {
                    // A browser without storage keeps it until the page closes
                  }
                }}
                className="w-36"
              />
            </div>
            <DataTable
              caption="البائعون"
              columns={[
                {
                  key: 'name',
                  header: 'البائع',
                  cell: (r) => <span className="font-semibold">{r.fullName || '—'}</span>,
                },
                {
                  key: 'n',
                  header: 'الفواتير',
                  numeric: true,
                  cell: (r) => <span className="num">{r.invoiceCount}</span>,
                },
                {
                  key: 'total',
                  header: 'المبيع',
                  numeric: true,
                  cell: (r) => <Money minor={r.totalMinor} currency={base} />,
                },
                {
                  key: 'back',
                  header: 'رجع منه',
                  numeric: true,
                  cell: (r) => <Money minor={r.returnedMinor} currency={base} />,
                },
                {
                  key: 'commission',
                  header: 'العمولة',
                  numeric: true,
                  cell: (r) => {
                    const c = commissionOf(r.totalMinor, r.returnedMinor, commission);
                    return c === null ? '—' : <Money minor={c} currency={base} className="font-bold" />;
                  },
                },
              ]}
              rows={data.bySeller}
              rowKey={(r) => r.userId}
            />
          </section>
        ) : null}

        {data && data.lowStock.length > 0 ? (
          <DataTable
            caption="قرّب يخلص"
            columns={[
              {
                key: 'name',
                header: 'القطعة',
                cell: (r) => (
                  <Link to={`/products/${r.productId}`} className="font-semibold text-brand-ink underline">
                    {r.label ? `${r.name} ${r.label}` : r.name}
                  </Link>
                ),
              },
              {
                key: 'stock',
                header: 'بقي',
                numeric: true,
                cell: (r) => (
                  <span className={r.stockQty <= 0 ? 'num font-bold text-danger-ink' : 'num font-bold'}>
                    {r.stockQty <= 0 ? 'نفد' : r.stockQty / 1000}
                  </span>
                ),
              },
              {
                key: 'sold',
                header: 'بيع في المدة',
                numeric: true,
                cell: (r) => <span className="num">{r.soldQty / 1000}</span>,
              },
              {
                key: 'min',
                header: 'الحد الأدنى',
                numeric: true,
                cell: (r) => (
                  <span className="num">{r.minStockQty === null ? '—' : r.minStockQty / 1000}</span>
                ),
              },
            ]}
            rows={data.lowStock}
            rowKey={(r) => r.variantId}
          />
        ) : null}

        <DataTable
          caption="القطع الراكدة"
          columns={slowColumns}
          rows={data?.slowMovers ?? []}
          rowKey={(r) => r.variantId}
          loading={!data && !error}
          {...(error ? { onRetry: load } : {})}
          empty="لا قطع راكدة: كل ما على الرف بيع منه شيء أو وصل حديثاً."
        />
      </div>
    </AppShell>
  );
}
