import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PriceModes } from './parts';
import { CatalogGate } from './CatalogGate';
import type { PriceChange, PriceChangeSource } from '@serva/core';
import { COUNT_NOUNS, countNoun } from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import { Alert, Button, Dialog, PercentIcon, Select, TextField } from '@serva/ui';
import { DeltaPill, EmptyState } from './shared';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { zonedDateTime } from '../../lib/dates';
import { DateField } from '../../lib/DateField';
import { downloadCsv } from '../exportCsv';
import { listProducts } from '../catalog/api';
import { useIsPhone } from '../../lib/useIsPhone';
import { Amt, DownloadGlyph, PageTop, Panel, SalesPage, SxTable, type SxColumn } from '../sales/ui';

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
    <DeltaPill rise={d > 0}>
      <Amt minor={Math.abs(d)} currency={row.currency} />
    </DeltaPill>
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
  // The change waiting for the owner's yes
  const [asking, setAsking] = useState<string | null>(null);
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

  // A whole change under one header: its rows sit together, the header holds «تراجع»
  const { ordered, batches, keyOf } = useMemo(() => groupBatches(items ?? []), [items]);

  function undoBatch(batchId: string) {
    if (undoing) return;
    setAsking(null);
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
        cell: (r) => <span className="sx-mute">{SOURCE_TEXT[r.source]}</span>,
      },
    ],
    [when],
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
        <Dialog
          open={asking !== null}
          onOpenChange={(open) => !open && setAsking(null)}
          size="sm"
          title="نرجّع هذا التغيير؟"
          description="نرجّع كل قطعة في هذا التغيير إلى سعرها قبله. ما تعدّل بعده يُترك كما هو."
          actions={
            <>
              <Button variant="secondary" onClick={() => setAsking(null)}>
                تراجع
              </Button>
              <Button variant="danger" onClick={() => undoBatch(asking ?? '')}>
                نعم، رجّع الأسعار
              </Button>
            </>
          }
        ></Dialog>
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
            {ordered.map((r, at) => {
              const key = keyOf.get(r.id) ?? r.id;
              const batch = batches.get(key);
              const startsGroup = at === 0 || keyOf.get(ordered[at - 1]!.id) !== key;
              return (
                <Fragment key={r.id}>
                  {startsGroup && batch ? (
                    <li className="rounded-card border border-line bg-surface-muted px-3 py-2">
                      <BatchHeader batch={batch} busy={undoing !== null} onUndo={() => setAsking(batch.id)} />
                    </li>
                  ) : null}
                  <li className="sx-icard" style={{ cursor: 'default' }}>
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
                </Fragment>
              );
            })}
          </ul>
        ) : (
          <Panel title="التغييرات" aside={items ? `${String(items.length)} تغيير` : undefined} flush>
            <SxTable
              bare
              caption="تغييرات الأسعار"
              columns={columns}
              rows={ordered}
              rowKey={(r) => r.id}
              groupOf={(r) => keyOf.get(r.id) ?? r.id}
              groupLabel={(key) => {
                const batch = batches.get(key);
                return batch ? (
                  <BatchHeader batch={batch} busy={undoing !== null} onUndo={() => setAsking(batch.id)} />
                ) : (
                  <span className="sx-mute">
                    تعديلات منفردة · <bdi>{key.slice(2, 12)}</bdi>
                  </span>
                );
              }}
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

/** What the header of one change says: what it was, how many pieces, who, and its «تراجع» */
interface Batch {
  id: string;
  title: string;
  pieces: number;
  who: string | null;
  undone: boolean;
}

/** The rows with each change's rows together (at the place its first row came), and one header per change */
export function groupBatches(items: readonly PriceChange[]): {
  ordered: PriceChange[];
  batches: Map<string, Batch>;
  /** Each row's group: its change's id, or one key for each run of loose edits of the same day */
  keyOf: Map<string, string>;
} {
  const batches = new Map<string, Batch>();
  const rowsOf = new Map<string, PriceChange[]>();
  const slots: (string | PriceChange)[] = [];
  for (const r of items) {
    if (!r.batchId) {
      slots.push(r);
      continue;
    }
    const list = rowsOf.get(r.batchId);
    if (list) list.push(r);
    else {
      rowsOf.set(r.batchId, [r]);
      slots.push(r.batchId);
    }
  }
  const ordered: PriceChange[] = [];
  const keyOf = new Map<string, string>();
  let run = 0;
  let lastPlain = '';
  for (const slot of slots) {
    if (typeof slot !== 'string') {
      const day = slot.at.slice(0, 10);
      if (lastPlain !== day) run += 1;
      lastPlain = day;
      keyOf.set(slot.id, `d:${day}#${String(run)}`);
      ordered.push(slot);
      continue;
    }
    lastPlain = '';
    for (const r of rowsOf.get(slot) ?? []) keyOf.set(r.id, slot);
    const rows = rowsOf.get(slot) ?? [];
    ordered.push(...rows);
    const first = rows[0]!;
    const counted = rows.filter((r) => r.productId !== null).length;
    batches.set(slot, {
      id: slot,
      title:
        first.source === 'price_list'
          ? `تحديث من ملف${first.note ? ` «${first.note}»` : ''}`
          : properSigns(first.note ?? SOURCE_TEXT.bulk),
      pieces: Math.max(first.batchPieces ?? 0, counted),
      who: first.userName,
      undone: rows.every((r) => r.undone === true),
    });
  }
  return { ordered, batches, keyOf };
}

function BatchHeader({ batch, busy, onUndo }: { batch: Batch; busy: boolean; onUndo: () => void }) {
  return (
    <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="font-semibold text-ink">
        {batch.title} · {countNoun(batch.pieces, COUNT_NOUNS.piece)}
        {batch.who ? <span className="sx-mute font-normal"> · {batch.who}</span> : null}
      </span>
      {batch.undone ? (
        <span className="sx-mute">تم التراجع عنه</span>
      ) : (
        <Button variant="secondary" size="xs" disabled={busy} onClick={onUndo}>
          تراجع عن هذا التغيير
        </Button>
      )}
    </span>
  );
}

function Piece({ row }: { row: PriceChange }) {
  if (row.productName) {
    return (
      <span className="font-semibold">
        {row.productName}
        {row.variantLabel ? <span className="sx-mute"> · {row.variantLabel}</span> : null}
        {((row.field && row.field !== 'price') || (row.source === 'bulk' && !row.batchId)) && row.note ? (
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
