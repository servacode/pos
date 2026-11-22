import { useEffect, useMemo, useState } from 'react';
import {
  COUNT_NOUNS,
  countNoun,
  SERIAL_FLAG_LABELS,
  serialLabel,
  type SerialRow,
  type UnassignedSerialSale,
} from '@serva/core';
import { Alert, Button, SearchField, BarcodeIcon, useDigits } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { fixSerialRow, serialsOf, unassignedSerialSales } from '../warranty/api';
import { getInventory } from './api';
import './inventory.css';

/** A document number over its date, or a dash when there is none. */
function DocCell({ number, date }: { number: string | null; date: string | null }) {
  const digits = useDigits();
  if (!number) return <span className="sx-sub">—</span>;
  return (
    <span className="flex flex-col items-start">
      <bdi dir="ltr" className="sx-n">
        {number}
      </bdi>
      {date ? <span className="sx-n sx-subline">{dayText(date, digits)}</span> : null}
    </span>
  );
}

/**
 * «الأرقام التسلسلية» (03 › الإلكترونيات): a phone by its IMEI — in stock or sold, when it came in
 * and went out, and until when its warranty runs.
 */
export function SerialsPage() {
  const digits = useDigits();
  const me = useMe();
  const label = serialLabel(me.tenant.sectors);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'flagged'>('all');
  const [items, setItems] = useState<SerialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  // The row being put right (and, for a number two sales took, the sale picked to keep it)
  const [confirming, setConfirming] = useState<{ serial: string; keep?: string } | null>(null);
  // Read-only check: a device with more numbers «في المحل» than pieces in stock (a sale went out without its number)
  const [all, setAll] = useState<SerialRow[] | null>(null);
  const [stock, setStock] = useState<Map<string, number> | null>(null);
  // «بيعات بلا رقم»: sales accepted from a till without a number for a device; the owner picks which piece left
  const [unassigned, setUnassigned] = useState<UnassignedSerialSale[]>([]);
  // More sales wait than the 50 shown: the rest come after these are settled
  const [unassignedMore, setUnassignedMore] = useState(false);
  const [picked, setPicked] = useState<{ key: string; serial: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void unassignedSerialSales().then(
      (r) => {
        if (!alive) return;
        setUnassigned(r.items);
        setUnassignedMore(Boolean(r.more));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [reloads]);
  useEffect(() => {
    let alive = true;
    void Promise.all([serialsOf({ q: '', flagged: false }), getInventory()]).then(
      ([serialList, inventory]) => {
        if (!alive) return;
        setAll(serialList.items);
        const byVariant = new Map<string, number>();
        for (const row of inventory.items)
          byVariant.set(row.variantId, (byVariant.get(row.variantId) ?? 0) + row.qty);
        setStock(byVariant);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [reloads]);
  const ahead = useMemo(() => {
    if (!all || !stock) return [];
    const counts = new Map<string, { name: string; n: number }>();
    for (const r of all) {
      if (r.status !== 'in_stock') continue;
      const c = counts.get(r.variantId) ?? { name: r.name, n: 0 };
      c.n += 1;
      counts.set(r.variantId, c);
    }
    return [...counts.entries()]
      .map(([variantId, c]) => ({
        name: c.name,
        n: c.n,
        inStock: Math.max(0, Math.round((stock.get(variantId) ?? 0) / 1000)),
      }))
      .filter((x) => x.n > x.inStock);
  }, [all, stock]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setError(null);
      serialsOf({ q: q.trim(), flagged: view === 'flagged' })
        .then((r) => setItems(r.items))
        .catch((e: unknown) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, view, reloads]);

  /** «تصحيح»: a sold number back in stock, or an in-stock one that was sold, by its history */
  async function fix(r: SerialRow, keepSaleId?: string) {
    setConfirming(null);
    try {
      await fixSerialRow(
        keepSaleId
          ? { serial: r.serial, status: 'sold', keepSaleId }
          : { serial: r.serial, status: r.status === 'sold' ? 'in_stock' : 'sold' },
      );
      setReloads((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /** The owner says which in-stock piece left with a sale that had no number */
  async function assign(item: UnassignedSerialSale, serial: string) {
    setPicked(null);
    try {
      await fixSerialRow({ serial, status: 'sold', saleId: item.saleId });
      setReloads((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function statusBadge(r: SerialRow) {
    return r.status === 'sold' ? (
      <StatusPill kind="ok">مباع</StatusPill>
    ) : r.status === 'returned' ? (
      <StatusPill kind="ok">أُعيد للمورد</StatusPill>
    ) : r.status === 'rented' ? (
      <StatusPill kind="warn">مؤجَّر</StatusPill>
    ) : (
      <StatusPill kind="open">في المحل</StatusPill>
    );
  }

  function flagsCell(r: SerialRow) {
    if (r.flags.length === 0 && r.sales.length <= 1) return <span className="sx-sub">—</span>;
    return (
      <span className="flex flex-col items-start gap-1">
        {r.flags.map((f) => (
          <StatusPill key={f} kind={f === 'override' ? 'open' : 'warn'}>
            {SERIAL_FLAG_LABELS[f]}
          </StatusPill>
        ))}
        <span className="sx-subline">
          {r.sales.map((s, i) => (
            <span key={i} className="block">
              <bdi dir="ltr" className="sx-n">
                {s.saleNumber ?? '—'}
              </bdi>
              {s.customerName ? ` · ${s.customerName}` : ' · بدون زبون'}
            </span>
          ))}
        </span>
      </span>
    );
  }

  /** «تصحيح»: says what it does, then asks; «لا» leaves the row as it is */
  function fixCell(r: SerialRow) {
    const twice = r.status === 'sold' && r.sales.filter((x) => x.saleId).length > 1;
    if (r.flags.length === 0 && r.status === 'in_stock') return null;
    if (confirming?.serial !== r.serial) {
      return (
        <Button size="sm" variant="secondary" onClick={() => setConfirming({ serial: r.serial })}>
          تصحيح
        </Button>
      );
    }
    if (twice && !confirming.keep) {
      return (
        <span className="flex flex-col items-start gap-2 text-sm" data-testid="serial-keep">
          <span>
            هذا الرقم خرج مع أكثر من بيعة. اختر البيعة التي يبقى معها، وتبقى الأخرى في السجل بعلامة «بيع أكثر
            من مرة»:
          </span>
          {r.sales.map((s) =>
            s.saleId ? (
              <Button
                key={s.saleId}
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => setConfirming({ serial: r.serial, keep: s.saleId! })}
              >
                <bdi dir="ltr" className="num">
                  {s.saleNumber ?? '—'}
                </bdi>
                {s.customerName ? ` · ${s.customerName}` : ' · بدون زبون'}
              </Button>
            ) : null,
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
            لا
          </Button>
        </span>
      );
    }
    const keep = confirming.keep;
    const what = keep
      ? 'يبقى الرقم مع البيعة التي اخترتها، وتنتقل كفالته إلى تاريخها.'
      : r.status === 'sold'
        ? 'يعود الرقم «في المحل» ويُفكّ عن فاتورته وكفالته.'
        : 'يُسجَّل الرقم «مباعاً» بآخر بيعة له في السجل، وتبدأ كفالته منها.';
    return (
      <span className="flex flex-col items-start gap-2 text-sm">
        <span>{what} لا يغيّر المخزون ولا الحسابات، ويُسجَّل باسمك.</span>
        <span className="flex w-full flex-wrap gap-2">
          <Button size="sm" onClick={() => void fix(r, keep)}>
            {keep ? 'نعم، يبقى معها' : r.status === 'sold' ? 'نعم، أرجعه للمخزون' : 'نعم، اعتبره مباعاً'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
            لا
          </Button>
        </span>
      </span>
    );
  }

  const columns: SxColumn<SerialRow>[] = [
    {
      key: 'serial',
      header: label === 'IMEI' ? 'IMEI' : 'الرقم',
      lead: true,
      cell: (r) => (
        <bdi dir="ltr" className="sx-n">
          {r.serial}
        </bdi>
      ),
    },
    { key: 'status', header: 'الحالة', cell: (r) => statusBadge(r) },
    { key: 'name', header: 'الجهاز', cell: (r) => r.name },
    {
      key: 'in',
      header: 'الاستلام',
      cell: (r) => <DocCell number={r.purchaseNumber} date={r.receivedOn} />,
    },
    {
      key: 'out',
      header: 'البيع',
      cell: (r) => <DocCell number={r.saleNumber} date={r.soldOn} />,
    },
    {
      key: 'warranty',
      header: 'الكفالة حتى',
      cell: (r) =>
        r.warrantyUntil ? (
          <span className="sx-n">{dayText(r.warrantyUntil, digits)}</span>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    { key: 'flags', header: 'للمراجعة', cell: (r) => flagsCell(r) },
    { key: 'fix', header: '', cell: (r) => fixCell(r) },
  ];

  return (
    <ReportScreen me={me} access={['catalog.manage']} title="الأرقام التسلسلية">
      <SalesPage>
        <PageTop
          title="الأرقام التسلسلية"
          subtitle="كل جهاز برقمه: في المحل أو مباع، متى استُلم ومتى بيع، والكفالة حتى متى."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {unassigned.length > 0 ? (
          <Alert tone="warning">
            <span data-testid="serials-unassigned" className="flex flex-col gap-3">
              <span className="font-semibold">
                بيعات خرجت بلا رقم تسلسلي. اختر الجهاز الذي خرج مع كل بيعة:
              </span>
              {unassignedMore ? (
                <span>تُعرض أحدث 50 بيعة، وهناك بيعات أقدم تظهر بعد أن تُنهي هذه.</span>
              ) : null}
              {unassigned.map((item) => {
                const key = `${item.saleId}:${item.variantId}`;
                return (
                  <span key={key} className="flex flex-col gap-2">
                    <span>
                      <bdi dir="ltr" className="num font-semibold">
                        {item.saleNumber}
                      </bdi>{' '}
                      · {item.name} · ينقصها {countNoun(item.missing, COUNT_NOUNS.piece)} برقم
                    </span>
                    {item.candidates.length === 0 ? (
                      <span className="text-sm">لا رقم «في المحل» لهذا الصنف.</span>
                    ) : picked?.key === key ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <bdi dir="ltr" className="num font-semibold">
                          {picked.serial}
                        </bdi>
                        <Button size="sm" onClick={() => void assign(item, picked.serial)}>
                          نعم، هذا الذي خرج
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                          لا
                        </Button>
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-2" role="group" aria-label="الأرقام في المحل">
                        {item.candidates.map((serial) => (
                          <button
                            key={serial}
                            type="button"
                            onClick={() => setPicked({ key, serial })}
                            className="num min-h-11 rounded-control border border-line-control bg-surface px-3 text-sm font-semibold text-ink hover:border-brand hover:bg-brand-soft"
                          >
                            <bdi dir="ltr">{serial}</bdi>
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          </Alert>
        ) : null}
        {ahead.length > 0 ? (
          <Alert tone="warning">
            <span data-testid="serials-ahead" className="flex flex-col gap-1">
              {ahead.map((x) => (
                <span key={x.name}>
                  {x.name}: {countNoun(x.n, COUNT_NOUNS.piece)} برقم مسجّل · المخزون{' '}
                  <bdi className="num font-semibold">{x.inStock}</bdi> — في بيعة بلا رقم.
                  {unassigned.length > 0 ? ' اختر الرقم الذي خرج من قائمة «بيعات خرجت بلا رقم» أعلاه.' : ''}
                </span>
              ))}
            </span>
          </Alert>
        ) : null}
        <section aria-label="الأجهزة" className="flex flex-col gap-3">
          <div className="sx-card sx-filterbar">
            <div className="sx-search">
              <SearchField
                label={`ابحث بـ${label === 'IMEI' ? 'IMEI' : 'الرقم التسلسلي'}`}
                value={q}
                onValueChange={setQ}
              />
            </div>
            <div role="radiogroup" aria-label="العرض" className="sx-chips">
              {(
                [
                  ['all', 'الكل'],
                  ['flagged', 'للمراجعة'],
                ] as const
              ).map(([key, text]) => (
                <label key={key} className="sx-chip">
                  <input
                    type="radio"
                    name="serial-view"
                    checked={view === key}
                    onChange={() => setView(key)}
                  />
                  {text}
                </label>
              ))}
            </div>
            <span className="sx-wait">{q.trim() ? 'ما يطابق بحثك.' : 'آخر ما استُلم أولاً.'}</span>
          </div>
          <ul className="sx-cards sm:hidden" aria-label="الأجهزة بأرقامها">
            {(items ?? []).map((r) => (
              <li key={r.serial} className="ix-icard">
                <bdi dir="ltr" className="n sx-n">
                  {r.serial}
                </bdi>
                <span className="v">{statusBadge(r)}</span>
                <span className="q">{r.name}</span>
                <span className="q" style={{ gridColumn: '1 / -1' }}>
                  {r.purchaseNumber ? (
                    <span className="flex items-center gap-1">
                      استُلم <DocCell number={r.purchaseNumber} date={r.receivedOn} />
                    </span>
                  ) : null}
                  {r.saleNumber ? (
                    <span className="flex items-center gap-1">
                      بيع <DocCell number={r.saleNumber} date={r.soldOn} />
                    </span>
                  ) : null}
                  {r.warrantyUntil ? <span>الكفالة حتى {dayText(r.warrantyUntil, digits)}</span> : null}
                </span>
                {r.flags.length > 0 ? <span className="c">{flagsCell(r)}</span> : null}
                {fixCell(r) ? <div className="c">{fixCell(r)}</div> : null}
              </li>
            ))}
            {items && items.length === 0 ? (
              <li className="sx-card ix-empty">
                <BarcodeIcon size={32} />
                <h3>لا رقم مطابق.</h3>
                <p>الأرقام تُكتب في فاتورة الشراء وتُمسح على الكاشير عند البيع.</p>
              </li>
            ) : null}
          </ul>
          <div className="hidden sm:block">
            <SxTable
              caption="الأجهزة بأرقامها"
              columns={columns}
              rows={items ?? []}
              rowKey={(r) => r.serial}
              loading={!items && !error}
              empty={
                <div className="ix-empty">
                  <BarcodeIcon size={32} />
                  <h3>لا رقم مطابق.</h3>
                  <p>الأرقام تُكتب في فاتورة الشراء وتُمسح على الكاشير عند البيع.</p>
                </div>
              }
            />
          </div>
        </section>
      </SalesPage>
    </ReportScreen>
  );
}
