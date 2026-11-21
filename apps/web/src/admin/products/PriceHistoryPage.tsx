import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PriceModes } from './parts';
import { CatalogGate } from './CatalogGate';
import type { PriceChange, PriceChangeSource } from '@serva/core';
import { COUNT_NOUNS, countNoun } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import { Alert, Button, EmptyState, PercentIcon, Select, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { zonedDateTime } from '../../lib/dates';
import { DateField } from '../../lib/DateField';
import { downloadCsv } from '../exportCsv';
import { listProducts } from '../catalog/api';
import { useIsPhone } from '../../lib/useIsPhone';
import {
  Amt,
  DownloadGlyph,
  PageTop,
  Panel,
  SalesPage,
  StatusPill,
  SxTable,
  type SxColumn,
} from '../sales/ui';

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

/** «-10%» as written in Arabic print: a true minus before a number and the Arabic percent sign */
export const properSigns = (text: string | null) => (text ?? '').replace(/-(?=\d)/g, '−').replace(/%/g, '٪');

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

const getHistory = (query: { productId: string; from: string; to: string; before?: string }) => {
  const params = new URLSearchParams();
  if (query.productId) params.set('productId', query.productId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.before) params.set('before', query.before);
  params.set('limit', '500');
  return apiFetch<{ items: PriceChange[]; nextCursor?: string | null }>(
    `/v1/price-history?${params.toString()}`,
    { auth: true },
  );
};

export function PriceHistoryPage() {
  return (
    <AppShell>
      <CatalogGate>
        <PriceHistory />
      </CatalogGate>
    </AppShell>
  );
}

/** «▲ 100» or «▼ 300» between the old and the new price, with its direction in words for a screen reader */
function Delta({ row }: { row: PriceChange }) {
  if (row.oldMinor === null || row.newMinor === null || !row.currency) return null;
  const d = row.newMinor - row.oldMinor;
  if (d === 0) return null;
  return (
    <StatusPill kind={d > 0 ? 'warn' : 'ok'}>
      <span className="sr-only">{d > 0 ? 'ارتفع' : 'انخفض'}</span>
      <span aria-hidden="true">{d > 0 ? '▲' : '▼'}</span>
      <Amt minor={Math.abs(d)} currency={row.currency} />
    </StatusPill>
  );
}

function PriceCell({
  minor,
  currency,
  strong,
}: {
  minor: number | null;
  currency: PriceChange['currency'];
  strong?: boolean;
}) {
  if (minor === null || !currency) return <span className="sx-z sx-n">—</span>;
  return <Amt minor={minor} currency={currency} className={strong ? 'font-bold' : 'sx-mute'} />;
}

function PriceHistory() {
  const me = useMe();
  const phone = useIsPhone();
  const digits = me.settings.numberFormat;
  const [items, setItems] = useState<PriceChange[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<{ id: string; nameAr: string }[]>([]);
  const [productId, setProductId] = useState('');
  // A slower answer to an older filter never replaces the answer to the latest one
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++latest.current;
    setError(null);
    getHistory({ productId, from, to })
      .then((r) => {
        if (mine === latest.current) {
          setItems(r.items);
          setNext(r.nextCursor ?? null);
        }
      })
      .catch((e: unknown) => {
        if (mine === latest.current) setError(errorMessage(e));
      });
  }, [productId, from, to]);
  useEffect(load, [load]);

  function loadMore() {
    if (!next || more) return;
    const mine = latest.current;
    setMore(true);
    getHistory({ productId, from, to, before: next })
      .then((r) => {
        if (mine !== latest.current) return;
        setItems((old) => [...(old ?? []), ...r.items]);
        setNext(r.nextCursor ?? null);
      })
      .catch((e: unknown) => {
        if (mine === latest.current) setError(errorMessage(e));
      })
      .finally(() => setMore(false));
  }

  // The product filter: type a name, pick one of the matches
  useEffect(() => {
    if (search.trim().length < 2) {
      setProducts([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      listProducts({ q: search.trim(), limit: 8 })
        .then((r) => {
          if (live) setProducts(r.items.map((p) => ({ id: p.id, nameAr: p.nameAr })));
        })
        .catch(() => {
          if (live) setProducts([]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  // One «تراجع» for a whole bulk change: on the first of its rows
  const firstOfBatch = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    for (const r of items ?? []) {
      if (r.batchId && !seen.has(r.batchId)) {
        seen.add(r.batchId);
        first.add(r.id);
      }
    }
    return first;
  }, [items]);

  function undoBatch(batchId: string) {
    if (undoing) return;
    if (!window.confirm('نرجّع كل قطعة في هذا التغيير إلى سعرها قبله. ما تعدّل بعده يُترك كما هو. نتابع؟'))
      return;
    setUndoing(batchId);
    setError(null);
    setNotice(null);
    apiFetch<{ restored: number; skipped: number }>(`/v1/prices/bulk/${batchId}/undo`, {
      method: 'POST',
      auth: true,
      body: {},
    })
      .then((r) => {
        setNotice(
          `رجعت ${countNoun(r.restored, COUNT_NOUNS.piece)} إلى سعرها قبل التغيير${
            r.skipped > 0 ? `، وتُركت ${countNoun(r.skipped, COUNT_NOUNS.piece)} لأنها تعدّلت بعده` : ''
          }.`,
        );
        load();
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setUndoing(null));
  }

  const tz = me.tenant.timezone;
  const when = useCallback((r: PriceChange) => zonedDateTime(r.at, tz, digits), [tz, digits]);

  const columns = useMemo<SxColumn<PriceChange>[]>(
    () => [
      { key: 'at', header: 'التاريخ', cell: (r) => <span className="whitespace-nowrap">{when(r)}</span> },
      { key: 'who', header: 'من غيّر', cell: (r) => r.userName ?? '—' },
      { key: 'piece', header: 'القطعة', lead: true, cell: (r) => <Piece row={r} /> },
      {
        key: 'old',
        header: 'قبل',
        numeric: true,
        cell: (r) => <PriceCell minor={r.oldMinor} currency={r.currency} />,
      },
      {
        key: 'new',
        header: 'بعد',
        numeric: true,
        cell: (r) => <PriceCell minor={r.newMinor} currency={r.currency} strong />,
      },
      { key: 'delta', header: 'الفرق', numeric: true, cell: (r) => <Delta row={r} /> },
      {
        key: 'source',
        header: 'المصدر',
        cell: (r) => (
          <span className="sx-mute">
            {SOURCE_TEXT[r.source]}
            {r.batchId && r.undone ? ' · تم التراجع عنه' : null}
            {r.batchId && !r.undone && firstOfBatch.has(r.id) ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={undoing !== null}
                onClick={() => undoBatch(r.batchId ?? '')}
              >
                تراجع عن هذا التغيير
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [when, firstOfBatch, undoing],
  );

  const filtered = Boolean(from || to || productId);

  return (
    <>
      <title>سجل تغيير الأسعار · SERVA</title>
      <SalesPage>
        <PageTop
          title="سجل تغيير الأسعار"
          subtitle="من غيّر سعراً ومتى ومن كم إلى كم ومن أين، من تعديل المنتج أو ملف الأسعار أو التغيير الجماعي."
          actions={
            <Button
              variant="secondary"
              icon={<DownloadGlyph />}
              disabled={!items || items.length === 0}
              onClick={() => {
                if (items) downloadCsv('سجل-الأسعار', HISTORY_HEADERS, historyRows(items));
              }}
            >
              صدّر إلى إكسل
            </Button>
          }
        />
        <PriceModes current="/price-history" />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <div className="sx-toolbar">
          <DateField label="من تاريخ" value={from} onChange={setFrom} />
          <DateField label="حتى تاريخ" value={to} onChange={setTo} />
          <TextField
            label="منتج معيّن (ابحث بالاسم)"
            placeholder="اكتب حرفين من الاسم"
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
          {filtered ? (
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
        {phone && items && items.length > 0 ? (
          <ul aria-label="تغييرات الأسعار" className="sx-cards">
            {items.map((r) => (
              <li key={r.id} className="sx-icard" style={{ cursor: 'default' }}>
                <span style={{ gridColumn: 1, gridRow: 1, minWidth: 0 }}>
                  <Piece row={r} />
                </span>
                <span className="st">
                  <Delta row={r} />
                </span>
                <span className="d">{when(r)}</span>
                <span className="t">
                  {r.oldMinor !== null && r.newMinor !== null && r.currency ? (
                    <>
                      <Amt minor={r.oldMinor} currency={r.currency} className="sx-mute" />
                      {' ← '}
                      <Amt minor={r.newMinor} currency={r.currency} />
                    </>
                  ) : null}
                </span>
                <span className="x">
                  {r.userName ?? '—'} · {SOURCE_TEXT[r.source]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Panel title="التغييرات" aside={items ? `${String(items.length)} تغيير` : undefined} flush>
            <SxTable
              bare
              caption="تغييرات الأسعار"
              columns={columns}
              rows={items ?? []}
              rowKey={(r) => r.id}
              loading={items === null && !error}
              empty={
                <EmptyState
                  icon={PercentIcon}
                  title="لا تغييرات في الأسعار هنا."
                  description="كل تغيير تُجريه من صفحة المنتج أو من ملف الأسعار أو بالتغيير الجماعي يظهر في هذا السجل."
                />
              }
            />
          </Panel>
        )}
        {next ? (
          <div className="flex justify-center">
            <Button variant="secondary" loading={more} onClick={loadMore}>
              اعرض تغييرات أقدم
            </Button>
          </div>
        ) : null}
      </SalesPage>
    </>
  );
}

function Piece({ row }: { row: PriceChange }) {
  if (row.productName) {
    return (
      <span className="font-semibold">
        {row.productName}
        {row.variantLabel ? <span className="sx-mute"> · {row.variantLabel}</span> : null}
        {((row.field && row.field !== 'price') || row.source === 'bulk') && row.note ? (
          <span className="sx-mute"> · {row.note}</span>
        ) : null}
      </span>
    );
  }
  // An old summary row (before each piece was logged on its own): its details were never kept
  return (
    <details className="text-sm">
      <summary className="cursor-pointer rounded-small text-ink-muted hover:text-ink">
        {properSigns(row.note)}
      </summary>
      <p className="pt-1 text-xs text-ink-subtle">
        تغيير قديم: التفاصيل غير محفوظة. التغييرات الجديدة تُسجَّل لكل صنف على حدة.
      </p>
    </details>
  );
}
