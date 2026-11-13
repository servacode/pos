import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PriceChange, PriceChangeSource } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  PercentIcon,
  Select,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { downloadCsv } from '../exportCsv';
import { listProducts } from '../catalog/api';

/**
 * «سجل تغيير الأسعار»: who changed a price, when, from what to what and from where. It reads the
 * audit trail the product page, «تحديث الأسعار من ملف» and «تغيير الأسعار» already write; nothing
 * here changes a price.
 */

export const SOURCE_TEXT: Record<PriceChangeSource, string> = {
  product_edit: 'صفحة المنتج',
  price_list: 'تحديث من ملف',
  price_list_summary: 'تحديث من ملف (ملخّص)',
  bulk: 'تغيير جماعي',
};

/** Local date and time, «2026-11-13 14:30» */
export const whenText = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** The CSV of the rows on screen: money in whole units of its currency */
export function historyRows(items: readonly PriceChange[]): (string | number)[][] {
  const units = (minor: number | null, currency: PriceChange['currency']) =>
    minor === null ? '' : minor / 10 ** CURRENCIES[currency ?? 'SYP'].decimals;
  return items.map((i) => [
    whenText(i.at),
    i.userName ?? '',
    SOURCE_TEXT[i.source],
    i.productName ?? '',
    i.variantLabel ?? '',
    i.currency ?? '',
    units(i.oldMinor, i.currency),
    units(i.newMinor, i.currency),
    i.note ?? '',
  ]);
}

export const HISTORY_HEADERS = [
  'التاريخ',
  'من غيّر',
  'المصدر',
  'المنتج',
  'القطعة',
  'العملة',
  'السعر قبل',
  'السعر بعد',
  'ملاحظة',
];

const getHistory = (query: { productId: string; from: string; to: string }) => {
  const params = new URLSearchParams();
  if (query.productId) params.set('productId', query.productId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  params.set('limit', '500');
  return apiFetch<{ items: PriceChange[] }>(`/v1/price-history?${params.toString()}`, { auth: true });
};

export function PriceHistoryPage() {
  return (
    <AppShell>
      <PriceHistory />
    </AppShell>
  );
}

function PriceHistory() {
  const [items, setItems] = useState<PriceChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<{ id: string; nameAr: string }[]>([]);
  const [productId, setProductId] = useState('');

  const load = useCallback(() => {
    setError(null);
    getHistory({ productId, from, to })
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [productId, from, to]);
  useEffect(load, [load]);

  // The product filter: type a name, pick one of the matches
  useEffect(() => {
    if (search.trim().length < 2) {
      setProducts([]);
      return;
    }
    const timer = setTimeout(() => {
      listProducts({ q: search.trim(), limit: 8 })
        .then((r) => setProducts(r.items.map((p) => ({ id: p.id, nameAr: p.nameAr }))))
        .catch(() => setProducts([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const columns = useMemo<DataColumn<PriceChange>[]>(
    () => [
      {
        key: 'at',
        header: 'التاريخ',
        cell: (r) => <span className="num whitespace-nowrap">{whenText(r.at)}</span>,
      },
      { key: 'who', header: 'من غيّر', cell: (r) => r.userName ?? '—' },
      {
        key: 'piece',
        header: 'القطعة',
        cell: (r) =>
          r.productName ? (
            <span className="font-semibold whitespace-nowrap">
              {r.productName}
              {r.variantLabel ? <span className="text-ink-muted"> · {r.variantLabel}</span> : null}
            </span>
          ) : (
            <span className="text-ink-muted">{r.note}</span>
          ),
      },
      {
        key: 'old',
        header: 'قبل',
        numeric: true,
        cell: (r) =>
          r.oldMinor === null || !r.currency ? (
            <span className="text-ink-subtle">—</span>
          ) : (
            <Money minor={r.oldMinor} currency={r.currency} className="text-ink-muted" />
          ),
      },
      {
        key: 'new',
        header: 'بعد',
        numeric: true,
        cell: (r) =>
          r.newMinor === null || !r.currency ? (
            <span className="text-ink-subtle">—</span>
          ) : (
            <Money minor={r.newMinor} currency={r.currency} className="font-bold text-ink" />
          ),
      },
      {
        key: 'source',
        header: 'المصدر',
        cell: (r) => <Badge tone={r.oldMinor === null ? 'neutral' : 'brand'}>{SOURCE_TEXT[r.source]}</Badge>,
      },
    ],
    [],
  );

  return (
    <>
      <title>سجل تغيير الأسعار · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<PercentIcon />}
          title="سجل تغيير الأسعار"
          description="من غيّر سعراً ومتى ومن كم إلى كم ومن أين، من تعديل المنتج أو ملف الأسعار أو التغيير الجماعي."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DateField label="من تاريخ" value={from} onChange={setFrom} />
            <DateField label="حتى تاريخ" value={to} onChange={setTo} />
            <TextField
              label="منتج معيّن (ابحث بالاسم)"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value) setProductId('');
              }}
            />
            {products.length > 0 ? (
              <Select label="اختر المنتج" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">كل المنتجات</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!items || items.length === 0}
              onClick={() => {
                if (items) downloadCsv('سجل-الأسعار', HISTORY_HEADERS, historyRows(items));
              }}
            >
              صدّر CSV
            </Button>
            {from || to || productId ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setProductId('');
                  setSearch('');
                }}
              >
                امسح الفلاتر
              </Button>
            ) : null}
          </div>
        </Card>
        {items && items.length === 0 ? (
          <EmptyState
            icon={PercentIcon}
            title="لا تغييرات في الأسعار هنا."
            description="كل تغيير تُجريه من صفحة المنتج أو من ملف الأسعار أو بالتغيير الجماعي يظهر في هذا السجل."
          />
        ) : (
          <DataTable
            caption="تغييرات الأسعار"
            columns={columns}
            rows={items ?? []}
            rowKey={(r) => r.id}
            loading={items === null && !error}
          />
        )}
      </div>
    </>
  );
}
