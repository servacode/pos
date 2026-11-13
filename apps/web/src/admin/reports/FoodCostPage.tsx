import { useState } from 'react';
import type { FoodCostReport, FoodCostRow } from '@serva/core';
import {
  Badge,
  Button,
  Card,
  DataTable,
  formatQuantity,
  Money,
  PageHeader,
  ReportsIcon,
  StatTile,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { apiFetch } from '../../lib/api';
import { isoDay, monthStart } from '../../lib/dates';
import { csvField, downloadText, minorToDecimal } from '../accounting/csv';
import { DayField, ReportFilters, ReportScreen } from './parts';
import { useReport } from './useReport';

/** `GET /v1/reports/food-cost` (report.view) */
export const getFoodCost = (q: { from: string; to: string }) =>
  apiFetch<FoodCostReport>(`/v1/reports/food-cost?${new URLSearchParams(q).toString()}`, { auth: true });

/** The margin as a percent of the price: «٧٥٪» */
export const marginPercent = (bp: number | null): string => (bp === null ? '—' : `${Math.round(bp / 100)}٪`);

/** The report as CSV for Excel */
export function foodCostCsv(r: FoodCostReport): string {
  const n = (minor: number | null) =>
    csvField(minor === null ? '' : minorToDecimal(minor, r.baseCurrency), true);
  const head = [
    'الوجبة',
    'السعر',
    'كلفة الحصة',
    'الهامش',
    'الهامش ٪',
    'المباع',
    'كلفة المباع',
    'مبيع المدة',
  ].map((h) => csvField(h));
  const lines = r.rows.map((x) => [
    csvField(x.name),
    n(x.priceMinor),
    n(x.costMinor),
    n(x.marginMinor),
    csvField(x.marginBp === null ? '' : String(Math.round(x.marginBp / 100)), true),
    csvField(String(x.soldQty / 1000), true),
    n(x.soldCostMinor),
    n(x.soldTotalMinor),
  ]);
  return `\uFEFF${[head, ...lines].map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}

/**
 * «كلفة الوجبات»: each dish with a recipe, what a portion costs from its ingredients' stock, its
 * price and margin, and what the period's sales of it cost. A report only: no stock, no posting.
 */
export function FoodCostPage() {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const { data, error, loading, retry } = useReport(`${from}|${to}`, () => getFoodCost({ from, to }));
  const base = data?.baseCurrency ?? me.settings.baseCurrency;

  const columns: DataColumn<FoodCostRow>[] = [
    {
      key: 'name',
      header: 'الوجبة',
      cell: (r) => (
        <span className="flex items-center gap-2 font-semibold">
          {r.name}
          {r.incomplete ? <Badge tone="warning">كلفة ناقصة</Badge> : null}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'السعر',
      numeric: true,
      cell: (r) => (r.priceMinor === null ? '—' : <Money minor={r.priceMinor} currency={base} />),
    },
    {
      key: 'cost',
      header: 'كلفة الحصة',
      numeric: true,
      cell: (r) => <Money minor={r.costMinor} currency={base} />,
    },
    {
      key: 'margin',
      header: 'الهامش',
      numeric: true,
      cell: (r) =>
        r.marginMinor === null ? (
          '—'
        ) : (
          <Money minor={r.marginMinor} currency={base} className="font-semibold" />
        ),
    },
    {
      key: 'marginPct',
      header: 'الهامش ٪',
      numeric: true,
      cell: (r) => (
        <Badge tone={r.marginBp !== null && r.marginBp < 3000 ? 'warning' : 'success'}>
          {marginPercent(r.marginBp)}
        </Badge>
      ),
    },
    { key: 'sold', header: 'المباع', numeric: true, cell: (r) => formatQuantity(r.soldQty) },
    {
      key: 'soldCost',
      header: 'كلفة المباع',
      numeric: true,
      cell: (r) => <Money minor={r.soldCostMinor} currency={base} />,
    },
  ];

  return (
    <ReportScreen me={me} access={['report.view']} title="كلفة الوجبات">
      <PageHeader
        title="كلفة الوجبات"
        description="كلفة كل وجبة من مكوّناتها، وهامشها، وكلفة ما بيع منها في المدة. للعرض فقط: لا تُنقص من المخزون ولا تُسجَّل في الحسابات."
        icon={<ReportsIcon />}
        actions={
          <Button
            variant="secondary"
            disabled={!data}
            onClick={() =>
              data && downloadText(`كلفة-الوجبات-${data.from}-${data.to}.csv`, foodCostCsv(data))
            }
          >
            صدّر CSV
          </Button>
        }
      />
      <ReportFilters>
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
      </ReportFilters>
      {error ? (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-ink">{error}</p>
          <Button variant="secondary" onClick={retry}>
            حاول مرة أخرى
          </Button>
        </Card>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label="مبيع المدة (وجبات بوصفة)"
              value={<Money minor={data.totalSoldMinor} currency={base} />}
            />
            <StatTile label="كلفتها" value={<Money minor={data.totalCostMinor} currency={base} />} />
            <StatTile
              label="الهامش"
              value={<Money minor={data.totalSoldMinor - data.totalCostMinor} currency={base} />}
            />
          </div>
          <DataTable
            caption="كلفة الوجبات"
            columns={columns}
            rows={data.rows}
            rowKey={(r) => r.productId}
            loading={loading}
            empty={<p className="p-4 text-ink-muted">لا وصفات بعد. أضف وصفة من صفحة الوجبة.</p>}
          />
          {data.withoutRecipe.length > 0 ? (
            <Card>
              <p className="font-semibold text-ink">بيعت في المدة دون وصفة</p>
              <p className="text-ink-muted">{data.withoutRecipe.map((d) => d.name).join('، ')}</p>
            </Card>
          ) : null}
        </>
      ) : null}
    </ReportScreen>
  );
}
