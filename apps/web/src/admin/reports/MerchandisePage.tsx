import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatMoney, type Category, type MerchandiseReport, type OptionSales } from '@serva/core';
import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  DataTable,
  ExpandIcon,
  cn,
  formatQuantity,
  Money,
  PageHeader,
  ReportsIcon,
  SegmentedControl,
  Select,
  KpiStrip,
  StatTile,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { storeSells } from '../../lib/sectors';
import { apiFetch, errorMessage } from '../../lib/api';
import { recallAnswer, rememberAnswer } from './useReport';
import { listCategories } from '../catalog/api';

type Slow = MerchandiseReport['slowMovers'][number];
type Piece = MerchandiseReport['models'][number]['pieces'][number];

const PERIODS = { '30': 'آخر 30 يوماً', '90': 'آخر 3 أشهر', '365': 'آخر سنة' } as const;
/** How long without a sale or a delivery makes a piece «راكد», for each period: one picker decides both */
const IDLE_FOR = { '30': '60', '90': '90', '365': '90' } as const;
const IDLE_TEXT = { '60': 'شهرين', '90': '3 أشهر' } as const;

/** YYYY-MM-DD of `days` days before today, in the browser's calendar */
export function daysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
}

export const getMerchandise = (from: string, to: string, idleDays: number, categoryId = '', season = '') =>
  apiFetch<MerchandiseReport>(
    `/v1/reports/merchandise?from=${from}&to=${to}&idleDays=${idleDays}${categoryId ? `&categoryId=${categoryId}` : ''}${season ? `&season=${encodeURIComponent(season)}` : ''}`,
    { auth: true },
  );

/** A section of the report that stays folded until its head is pressed; its tables are kept in the page, hidden */
function Fold({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={`قسم ${title}`} className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 text-start text-lg font-semibold text-ink shadow-e1 transition-colors duration-120 ease-standard hover:bg-surface-muted print:hidden"
      >
        {title}
        <ExpandIcon
          size={20}
          className={cn(
            'shrink-0 text-ink-subtle transition-transform duration-120 ease-standard',
            open && 'rotate-180',
          )}
        />
      </button>
      <div hidden={!open} className="flex flex-col gap-4 print:block!">
        {children}
      </div>
    </section>
  );
}

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
  const me = useMe();
  // Sizes, colours and models are a clothing shop's words; the others sell «أصناف» with options
  const clothing = storeSells(me.tenant.sectors, ['clothing']);
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30');
  const [departments, setDepartments] = useState<Category[]>([]);
  const [department, setDepartment] = useState('');
  const [commission, setCommission] = useState(readCommission);
  const [season, setSeason] = useState('');
  // The seasons are kept once known, so the filter stays when a season shows nothing
  const [seasons, setSeasons] = useState<string[]>([]);
  useEffect(() => {
    listCategories()
      .then((r) => setDepartments(r.items.filter((c) => c.parentId === null && !c.archivedAt)))
      .catch(() => setDepartments([]));
  }, []);
  const idle = IDLE_FOR[period];
  const [data, setData] = useState<MerchandiseReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    // The last answer for these filters stays on screen while the new one loads
    const key = `merchandise|${period}|${idle}|${department}|${season}`;
    setData(recallAnswer<MerchandiseReport>(key));
    getMerchandise(daysAgo(Number(period)), daysAgo(0), Number(idle), department, season)
      .then((report) => {
        rememberAnswer(key, report);
        setData(report);
        setSeasons((known) => (report.seasons?.length ? report.seasons : known));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [period, idle, department, season]);
  useEffect(load, [load]);

  const digits = useDigits();
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

  // The long tables open one at a time (or all together), so the page is one screen long
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const FOLDS = ['dept', 'options', 'models', 'sellers', 'low', 'slow'] as const;
  const isOpen = (id: string) => opened.has(id);
  const toggle = (id: string) =>
    setOpened((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allOpen = FOLDS.every((id) => opened.has(id));

  return (
    <AppShell>
      <title>حركة الأصناف · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          className="print:hidden"
          icon={<ReportsIcon />}
          title="حركة الأصناف"
          description={
            clothing
              ? 'ما يُباع من كل مقاس ولون وما يرجع، وما بقي من كل موديل، والقطع الراكدة على الرف.'
              : 'ما يُباع من كل صنف وخياراته وما يرجع منه، والأصناف الراكدة على الرف.'
          }
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 !p-4 print:hidden">
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
          {seasons.length > 0 ? (
            <Select label="الموسم" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="">كل المواسم</option>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : null}
          <p className="text-sm text-ink-muted">راكد: لم يُبع ولم يصل منذ {IDLE_TEXT[idle]}.</p>
        </Card>
        <KpiStrip columns={2}>
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
        </KpiStrip>

        {/* One switch for every section, just above them (it was a stray button in the page head) */}
        <div className="-mb-2 flex justify-end print:hidden">
          <Button variant="ghost" size="sm" onClick={() => setOpened(allOpen ? new Set() : new Set(FOLDS))}>
            {allOpen ? 'اطوِ كل الأقسام' : 'افتح كل الأقسام'}
          </Button>
        </div>

        {data && data.byDepartment.length > 0 && (departments.length > 0 || department) ? (
          <Fold title="المبيعات حسب القسم" open={isOpen('dept')} onToggle={() => toggle('dept')}>
            {data.byDepartment.length > 1 ? (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-ink">المبيعات حسب القسم</h2>
                <BarChart
                  label="صافي المبيعات حسب القسم بعد المرتجع"
                  orientation="horizontal"
                  labels={data.byDepartment.map((d) => d.name)}
                  series={[
                    {
                      key: 'net',
                      label: 'الصافي',
                      values: data.byDepartment.map((d) => d.totalMinor - d.returnedMinor),
                    },
                  ]}
                  formatValue={(value) => formatMoney(value, base, { digits })}
                  labelHeader="القسم"
                />
              </Card>
            ) : null}
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
                  cell: (r) => <span className="num">{formatQuantity(r.soldQty)}</span>,
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
          </Fold>
        ) : null}

        {/* Only a shop of sizes and colours is told what an option is: the others have no such line */}
        {data && data.byOption.length === 0 && clothing ? (
          <Alert tone="info">
            {clothing
              ? 'لا مبيعات لقطع لها مقاس أو لون في هذه المدة. أضف «المقاسات والألوان» في بطاقة المنتج.'
              : 'لا مبيعات لأصناف لها خيارات (مثل الحجم أو النوع) في هذه المدة.'}
          </Alert>
        ) : null}
        {data && data.byOption.length > 0 ? (
          <Fold
            title={`المبيعات حسب ${data.byOption.map((g) => g.name).join(' و')}`}
            open={isOpen('options')}
            onToggle={() => toggle('options')}
          >
            {data.byOption.map((group) => (
              <DataTable
                key={group.name}
                caption={`المبيعات حسب ${group.name}`}
                columns={optionColumns}
                rows={group.values}
                rowKey={(r) => r.value}
              />
            ))}
          </Fold>
        ) : null}

        {data && data.models.length > 0 ? (
          <Fold
            title={clothing ? 'الموديلات الأكثر مبيعاً' : 'الأصناف الأكثر مبيعاً'}
            open={isOpen('models')}
            onToggle={() => toggle('models')}
          >
            {data.models.map((m) => (
              <DataTable
                key={m.productId}
                caption={m.name}
                columns={pieceColumns}
                rows={m.pieces}
                rowKey={(r) => r.variantId}
              />
            ))}
          </Fold>
        ) : null}

        {data && data.bySeller.length > 0 ? (
          <Fold
            title="المبيعات حسب البائع والعمولة"
            open={isOpen('sellers')}
            onToggle={() => toggle('sellers')}
          >
            <div className="flex flex-wrap items-end gap-3">
              <span className="flex-1" />
              <TextField
                label="نسبة العمولة ٪"
                hint="تُستعمل لمن لم تحدّد له نسبة في صفحة الموظفين"
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
                    const c =
                      r.commissionBp !== null && r.commissionBp !== undefined
                        ? Math.round(((r.totalMinor - r.returnedMinor) * r.commissionBp) / 10_000)
                        : commissionOf(r.totalMinor, r.returnedMinor, commission);
                    return c === null ? '—' : <Money minor={c} currency={base} className="font-bold" />;
                  },
                },
              ]}
              rows={data.bySeller}
              rowKey={(r) => r.userId}
            />
          </Fold>
        ) : null}

        {data && data.lowStock.length > 0 ? (
          <Fold title="يوشك على النفاد" open={isOpen('low')} onToggle={() => toggle('low')}>
            <DataTable
              caption="يوشك على النفاد"
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
                      {r.stockQty <= 0 ? 'نفد' : formatQuantity(r.stockQty)}
                    </span>
                  ),
                },
                {
                  key: 'sold',
                  header: 'بيع في المدة',
                  numeric: true,
                  cell: (r) => <span className="num">{formatQuantity(r.soldQty)}</span>,
                },
                {
                  key: 'min',
                  header: 'الحد الأدنى',
                  numeric: true,
                  cell: (r) => (
                    <span className="num">
                      {r.minStockQty === null ? '—' : formatQuantity(r.minStockQty)}
                    </span>
                  ),
                },
              ]}
              rows={data.lowStock}
              rowKey={(r) => r.variantId}
            />
          </Fold>
        ) : null}

        {/* No sleeping pieces: the section is left out, the tile above already says «0» */}
        {data && data.slowMovers.length === 0 && !error ? null : (
          <Fold title="القطع الراكدة" open={isOpen('slow') || !data} onToggle={() => toggle('slow')}>
            <DataTable
              caption="القطع الراكدة"
              columns={slowColumns}
              rows={data?.slowMovers ?? []}
              rowKey={(r) => r.variantId}
              loading={!data && !error}
              {...(error ? { onRetry: load } : {})}
              empty="لا قطع راكدة: كل ما على الرف بيع منه شيء أو وصل حديثاً."
            />
          </Fold>
        )}
      </div>
    </AppShell>
  );
}
