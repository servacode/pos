import { useCallback, useEffect, useState } from 'react';
import type {
  InventoryResponse,
  TransferDetail,
  TransferFull,
  TransferInput,
  TransferListResponse,
  TransferMode,
  TransferRow,
  TransferSettings,
} from '@serva/core';
import {
  Alert,
  BackIcon,
  Button,
  Checkbox,
  CheckIcon,
  Dialog,
  formatQuantity,
  Select,
  TextField,
  TransferIcon,
  TruckIcon,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { apiFetch, ApiError, errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { ReportScreen } from '../reports/parts';
import { Amt, PageTop, Panel, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { getInventory, qtyOf, storeToday } from './api';
import { Caption, LinesHead, LinesTable, RemoveLine, WayArrow } from './parts';
import { PackQty } from './PackQty';
import { baseQtyOf, packSummary, withPackChange } from './packLines';
import { TransferReceive } from './TransferReceive';
import { VariantPicker, type PickedVariant } from './VariantPicker';
import './inventory.css';

const listTransfers = (cursor: string | null) =>
  apiFetch<TransferListResponse>(`/v1/transfers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
    auth: true,
  });
const transferSettings = () => apiFetch<TransferSettings>('/v1/transfers/settings', { auth: true });
const saveTransferMode = (mode: TransferMode) =>
  apiFetch<TransferSettings>('/v1/transfers/settings', { method: 'PUT', body: { mode }, auth: true });
const createTransfer = (input: TransferInput) =>
  apiFetch<TransferDetail>('/v1/transfers', { method: 'POST', body: input, auth: true });
const cancelTransfer = (id: string, body: { date: string; reason: string | null }) =>
  apiFetch<TransferFull>(`/v1/transfers/${id}/cancel`, { method: 'POST', body, auth: true });

interface Line extends PickedVariant {
  /** Pieces, or packs of `packQty` pieces (thousandths) when the item has packs */
  qty: string;
  packQty: number;
  /** Serial numbers of a device sent, one per piece (shown when the product tracks them) */
  serials?: string;
}

/** The grid of a transfer line: the item, its quantity and the bin. */
const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_14rem_2.5rem]';

/**
 * «التحويل بين الفروع» (09 › transfers): goods sent from one branch to another, out of the sender at its
 * average cost and into the receiver at that value; each branch's stock and books move together. Round 37
 * (decision 16): a store with more than one branch sends «بالطريق» by default: the goods leave the sender at
 * once and the receiving branch confirms what arrived (a shortage is written off with its reason); a store
 * may keep the one-step transfer. A model in sizes and colours opens as a grid, its quantities typed in one go.
 *
 * Round 44: what waits to be received comes first, a transfer on the way can be cancelled by its sender, a line
 * shows what the sender holds and refuses more unless the owner says so, and the list pages (every transfer
 * still on the way is always in it).
 */
export function TransfersPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const branches = me.branches;
  const base = me.settings.baseCurrency;
  const [items, setItems] = useState<TransferRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [onTheWay, setOnTheWay] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [only, setOnly] = useState<'all' | 'transit'>('all');
  const [composing, setComposing] = useState(false);
  const [from, setFrom] = useState(branches[0]?.id ?? '');
  const [to, setTo] = useState(branches[1]?.id ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<TransferDetail | null>(null);
  const [settings, setSettings] = useState<TransferSettings | null>(null);
  const [receiving, setReceiving] = useState<TransferRow | null>(null);
  const [received, setReceived] = useState<TransferFull | null>(null);
  // Cancelling a transfer on the way: asked first, with a reason that is not required
  const [cancelling, setCancelling] = useState<TransferRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<TransferFull | null>(null);
  // What the sender holds, to say it on every line and to stop a typing slip (needs the cost right; else not shown)
  const [stock, setStock] = useState<InventoryResponse | null>(null);
  const [allowOver, setAllowOver] = useState(false);

  const load = useCallback(() => {
    setListError(null);
    listTransfers(null)
      .then((r) => {
        setItems(r.items);
        setNextCursor(r.nextCursor ?? null);
        setOnTheWay(r.inTransit ?? r.items.filter((t) => t.status === 'in_transit').length);
      })
      .catch((e: unknown) => setListError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    transferSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  async function more() {
    if (!nextCursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const r = await listTransfers(nextCursor);
      setItems((now) => [...(now ?? []), ...r.items]);
      setNextCursor(r.nextCursor ?? null);
    } catch (e) {
      setListError(errorMessage(e));
    } finally {
      setMoreBusy(false);
    }
  }

  const open = composing || (items !== null && items.length === 0 && !listError);
  useEffect(() => {
    if (!open || stock) return;
    getInventory()
      .then(setStock)
      .catch(() => setStock(null));
  }, [open, stock]);

  async function chooseMode(mode: TransferMode) {
    setError(null);
    try {
      setSettings(await saveTransferMode(mode));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const parsed = lines.map((l) => baseQtyOf(l));
  const held = (variantId: string): number | null => {
    if (!stock) return null;
    return stock.items.find((r) => r.branchId === from && r.variantId === variantId)?.qty ?? 0;
  };
  const over = lines.map((l, i) => {
    const have = held(l.variantId);
    return have !== null && parsed[i] !== null && parsed[i]! > Math.max(0, have);
  });
  const serverOver = Object.keys(fields).some((k) => /^lines\.\d+\.qty$/.test(k));
  const overAny = over.some(Boolean) || serverOver;
  const ready =
    from &&
    to &&
    from !== to &&
    lines.length > 0 &&
    parsed.every((q) => q !== null && q > 0) &&
    (!over.some(Boolean) || allowOver);
  const pieces = parsed.reduce<number>((sum, q) => sum + (q ?? 0), 0);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      setDone(
        await createTransfer({
          fromBranchId: from,
          toBranchId: to,
          date: storeToday(me.tenant.timezone),
          note: note.trim() || null,
          // More than the sender holds is refused unless the owner ticked that he means it
          ...(allowOver ? {} : { strictStock: true }),
          lines: lines.map((l, i) => ({
            variantId: l.variantId,
            qty: parsed[i]!,
            ...(l.serials?.trim()
              ? {
                  serials: l.serials
                    .split(/[\n,،]+/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
        }),
      );
      setLines([]);
      setNote('');
      setAllowOver(false);
      setComposing(false);
      setStock(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const made = await cancelTransfer(cancelling.id, {
        date: storeToday(me.tenant.timezone),
        reason: cancelReason.trim() || null,
      });
      setCancelling(null);
      setCancelReason('');
      setCancelled(made);
      load();
    } catch (e) {
      setCancelError(errorMessage(e));
    } finally {
      setCancelBusy(false);
    }
  }

  const waiting = (items ?? []).filter((t) => t.status === 'in_transit');
  const waitingValue = waiting.reduce((sum, t) => sum + t.valueMinor, 0);
  const oldest = [...waiting].sort((a, b) => a.date.localeCompare(b.date))[0];
  const shown = only === 'transit' ? waiting : (items ?? []);

  const statusOf = (r: TransferRow) =>
    r.status === 'in_transit' ? (
      <StatusPill kind="warn" icon={<TruckIcon size={16} />}>
        في الطريق
      </StatusPill>
    ) : r.status === 'cancelled' ? (
      <StatusPill kind="danger" icon={<UndoIcon size={16} />}>
        أُلغي وعاد للمرسِل
      </StatusPill>
    ) : r.shortPieces ? (
      <StatusPill kind="danger">
        استُلم وفيه نقص <span className="sx-n">{formatQuantity(r.shortPieces, digits)}</span>
      </StatusPill>
    ) : (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        تمّ: خرج ودخل
      </StatusPill>
    );

  const actionsOf = (r: TransferRow) =>
    r.status === 'in_transit' ? (
      <span className="ix-acts">
        {r.canReceive !== false ? (
          <Button variant="secondary" size="sm" onClick={() => setReceiving(r)}>
            استلم
          </Button>
        ) : null}
        {r.canCancel !== false ? (
          <Button
            variant="danger-soft"
            size="sm"
            onClick={() => {
              setCancelError(null);
              setCancelling(r);
            }}
          >
            ألغِ التحويل
          </Button>
        ) : null}
      </span>
    ) : null;

  const columns: SxColumn<TransferRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      lead: true,
      cell: (r) => (
        <bdi dir="ltr" className="sx-n">
          {r.number}
        </bdi>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (r) => <span className="sx-mute sx-n">{dayText(r.date, digits)}</span>,
    },
    { key: 'way', header: 'من ← إلى', cell: (r) => <Route from={r.fromBranch} to={r.toBranch} /> },
    { key: 'status', header: 'الحالة', cell: statusOf },
    {
      key: 'pieces',
      header: 'القطع',
      numeric: true,
      cell: (r) => <span className="sx-n">{formatQuantity(r.pieces, digits)}</span>,
    },
    {
      key: 'value',
      header: 'بالكلفة',
      numeric: true,
      strong: true,
      cell: (r) => <Amt minor={r.valueMinor} currency={base} />,
    },
    { key: 'act', header: '', cell: actionsOf },
  ];

  return (
    <ReportScreen me={me} access={['inventory.adjust']} title="التحويل بين الفروع">
      <SalesPage>
        <PageTop
          title="التحويل بين الفروع"
          subtitle="بضاعة من فرع إلى آخر بكلفتها: مخزون كل فرع ودفاتره يتحرّكان معاً."
          actions={
            branches.length >= 2 && !open ? (
              <Button icon={<TransferIcon />} onClick={() => setComposing(true)}>
                تحويل جديد
              </Button>
            ) : null
          }
        />
        {branches.length < 2 ? (
          <section className="sx-card ix-empty" aria-label="فرع واحد">
            <TransferIcon size={32} />
            <h3>للمحل فرع واحد.</h3>
            <p>التحويل يظهر حين يكون لك فرعان أو أكثر.</p>
          </section>
        ) : null}
        {branches.length >= 2 && items ? (
          <section aria-label="ما ينتظر الاستلام" className="sx-card sx-strip ix-hero">
            <div>
              <span className="sx-eyebrow">تنتظر الاستلام</span>
              <span className={`v big sx-n${onTheWay > 0 ? ' warn' : ''}`}>
                {onTheWay.toLocaleString('en-US')}
              </span>
              <span className="note">
                {onTheWay > 0 ? 'خرجت من المرسِل ولم تدخل الفرع الآخر' : 'لا شيء في الطريق'}
              </span>
            </div>
            <div>
              <span className="sx-eyebrow">قيمتها بالكلفة</span>
              <span className="v">
                {onTheWay > 0 ? (
                  <Amt minor={waitingValue} currency={base} />
                ) : (
                  <span className="sx-sub">—</span>
                )}
              </span>
              <span className="note">لا تُحسب في مخزون أي فرع حتى تُستلم</span>
            </div>
            <div>
              <span className="sx-eyebrow">أقدمها</span>
              <span className="v sx-n">{oldest ? dayText(oldest.date, digits) : '—'}</span>
              <span className="note">{oldest ? <bdi dir="ltr">{oldest.number}</bdi> : null}</span>
            </div>
          </section>
        ) : null}
        {done ? (
          <Alert tone="success">
            سُجّل التحويل {done.number} بكلفة <Amt minor={done.valueMinor} currency={base} />.{' '}
            {done.status === 'in_transit'
              ? 'خرج من الفرع المرسِل وهو في الطريق: يؤكّد الفرع الآخر وصوله من القائمة.'
              : 'دخل مخزون الفرع الآخر.'}
          </Alert>
        ) : null}
        {received ? (
          <Alert tone={received.receipt?.shortPieces ? 'warning' : 'success'}>
            استُلم التحويل {received.number}.
            {received.receipt?.shortPieces
              ? ` سُجّل النقص (${formatQuantity(received.receipt.shortPieces, digits)}) بقيد الجرد ${received.receipt.stocktakeNumber ?? ''}.`
              : ' وصل كله ودخل مخزون الفرع.'}
          </Alert>
        ) : null}
        {cancelled ? (
          <Alert tone="success">
            أُلغي التحويل {cancelled.number} وعادت قطعه إلى {cancelled.fromBranch} بكلفتها.
          </Alert>
        ) : null}
        {receiving ? (
          <TransferReceive
            row={receiving}
            onCancel={() => setReceiving(null)}
            onDone={(t) => {
              setReceiving(null);
              setReceived(t);
              load();
            }}
          />
        ) : null}
        {branches.length >= 2 ? (
          <section aria-label="التحويلات السابقة" className="flex flex-col gap-3">
            {items && items.length > 0 ? (
              <div className="sx-card sx-filterbar">
                <div role="radiogroup" aria-label="اعرض" className="sx-chips scroll">
                  <label className="sx-chip">
                    <input
                      type="radio"
                      name="transfer-only"
                      checked={only === 'all'}
                      onChange={() => setOnly('all')}
                    />
                    الكل
                  </label>
                  <label className="sx-chip">
                    <input
                      type="radio"
                      name="transfer-only"
                      checked={only === 'transit'}
                      onChange={() => setOnly('transit')}
                    />
                    في الطريق
                    <span className="sx-n sx-sub">{waiting.length}</span>
                  </label>
                </div>
                <span className="sx-wait">
                  الأحدث أولاً. ما «في الطريق» يؤكّد الفرع الآخر وصوله بزر «استلم»، وما نقص يُسجَّل بقيد جرد.
                </span>
              </div>
            ) : null}
            {phone && shown.length > 0 ? (
              <ul aria-label="التحويلات" className="sx-cards">
                {shown.map((r) => (
                  <li key={r.id} className="ix-icard">
                    <bdi dir="ltr" className="n sx-n">
                      {r.number}
                    </bdi>
                    <span className="v">{statusOf(r)}</span>
                    <span className="q">
                      <Route from={r.fromBranch} to={r.toBranch} />
                    </span>
                    <span className="u sx-n">{dayText(r.date, digits)}</span>
                    <span className="q">
                      <span className="sx-n">{formatQuantity(r.pieces, digits)}</span> قطعة ·{' '}
                      <Amt minor={r.valueMinor} currency={base} />
                    </span>
                    {actionsOf(r) ? <span className="c">{actionsOf(r)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : items && items.length === 0 && !listError ? (
              <p className="sx-note tight">لا تحويلات بعد. كل تحويل تسجّله يظهر هنا برقمه وكلفته.</p>
            ) : (
              <SxTable
                caption="التحويلات"
                columns={columns}
                rows={shown}
                rowKey={(r) => r.id}
                loading={!items && !listError}
                error={listError ?? undefined}
                onRetry={load}
                empty={<p className="sx-empty">لا شيء في الطريق الآن.</p>}
              />
            )}
            {nextCursor ? (
              <div className="flex justify-center">
                <Button variant="secondary" loading={moreBusy} onClick={() => void more()}>
                  اعرض تحويلات أقدم
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {branches.length >= 2 && open ? (
          <section aria-label="تحويل جديد">
            <Panel
              title="تحويل جديد"
              aside={
                composing && items && items.length > 0 ? (
                  <button type="button" className="sx-linkbtn" onClick={() => setComposing(false)}>
                    أغلق
                  </button>
                ) : null
              }
            >
              <div className="flex flex-col gap-5">
                {error ? <Alert tone="error">{error}</Alert> : null}
                <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <Select label="من فرع" value={from} onChange={(e) => setFrom(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                  <WayArrow />
                  <Select
                    label="إلى فرع"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    error={from === to ? 'اختر فرعين مختلفين.' : undefined}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <VariantPicker
                  noCost
                  onPick={(v) =>
                    setLines((list) =>
                      list.some((l) => l.variantId === v.variantId)
                        ? list
                        : [...list, { ...v, qty: '', packQty: 1000 }],
                    )
                  }
                  onPickGrid={(picked) =>
                    setLines((list) => [
                      ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                      ...picked.map((p) => ({
                        variantId: p.variantId,
                        name: p.name,
                        qty: p.qty,
                        packQty: 1000,
                      })),
                    ])
                  }
                />
                {lines.length > 0 ? (
                  <LinesTable
                    label="أصناف التحويل"
                    head={
                      <LinesHead className={LINE_COLUMNS}>
                        <span>الصنف</span>
                        <span>الكمية</span>
                        <span />
                      </LinesHead>
                    }
                  >
                    {lines.map((l, i) => {
                      const have = held(l.variantId);
                      return (
                        <li
                          key={l.variantId}
                          className={`grid grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:items-center ${LINE_COLUMNS}`}
                        >
                          <span className="flex min-w-0 flex-col md:self-center">
                            <span className="truncate font-semibold text-ink">{l.name}</span>
                            {have !== null ? (
                              <span
                                className={
                                  over[i]
                                    ? 'text-xs font-semibold text-danger-ink'
                                    : 'text-xs text-ink-subtle'
                                }
                              >
                                المتوفر عند المرسِل:{' '}
                                <bdi className="num">{formatQuantity(Math.max(0, have), digits)}</bdi>
                                {over[i] ? ' — الكمية أكبر من المتوفر' : ''}
                              </span>
                            ) : null}
                            {l.packQty > 1000 && parsed[i] ? (
                              <span className="text-xs font-normal text-ink-subtle">
                                {packSummary(
                                  qtyOf(l.qty) ?? 0,
                                  l.packs?.find((x) => x.qty === l.packQty) ?? null,
                                  (q) => formatQuantity(q, digits),
                                )}
                              </span>
                            ) : null}
                            {fields[`lines.${i}.qty`] ? (
                              <span className="text-xs font-semibold text-danger-ink">
                                {fields[`lines.${i}.qty`]}
                              </span>
                            ) : null}
                          </span>
                          <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                            <Caption>الكمية</Caption>
                            <PackQty
                              name={l.name}
                              packs={l.packs}
                              qty={l.qty}
                              packQty={l.packQty}
                              onChange={(patch) =>
                                setLines((all) => all.map((x, j) => (j === i ? withPackChange(x, patch) : x)))
                              }
                            />
                          </div>
                          <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                            <RemoveLine
                              name={l.name}
                              onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                            />
                          </div>

                          {fields[`lines.${i}.serials`] || l.serials ? (
                            <div className="col-span-2 md:col-span-3">
                              <label className="flex flex-col gap-1.5">
                                <span className="text-xs font-semibold text-ink-subtle">
                                  الأرقام التسلسلية (رقم لكل قطعة، واحد في كل سطر)
                                </span>
                                <textarea
                                  aria-label={`أرقام ${l.name}`}
                                  dir="ltr"
                                  rows={2}
                                  value={l.serials ?? ''}
                                  onChange={(e) =>
                                    setLines((all) =>
                                      all.map((x, j) => (j === i ? { ...x, serials: e.target.value } : x)),
                                    )
                                  }
                                  className="num rounded-control border border-line-control bg-surface px-3 py-2 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-120 ease-standard hover:border-ink-subtle focus:border-brand focus:outline-hidden"
                                />
                                {fields[`lines.${i}.serials`] ? (
                                  <span className="text-sm text-danger-ink">
                                    {fields[`lines.${i}.serials`]}
                                  </span>
                                ) : null}
                              </label>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </LinesTable>
                ) : null}
                {overAny ? (
                  <Alert tone="warning">
                    <span className="flex flex-col gap-2">
                      <span>
                        في السطور كميات أكبر مما عند الفرع المرسِل. غالباً هذا خطأ في الكتابة. إن كان مقصوداً
                        (بضاعة وصلته ولم تُسجَّل بعد) فأكّد ذلك، وسيصير مخزونه بالسالب.
                      </span>
                      <Checkbox
                        label="أرسل رغم نقص المتوفر"
                        checked={allowOver}
                        onChange={(e) => setAllowOver(e.target.checked)}
                      />
                    </span>
                  </Alert>
                ) : null}
                <TextField
                  label="ملاحظة (اختياري)"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                  <p className="text-sm text-ink-muted">
                    {lines.length > 0 ? (
                      <>
                        الأصناف: <span className="num font-semibold text-ink">{lines.length}</span> · القطع:{' '}
                        <span className="num font-semibold text-ink">{formatQuantity(pieces, digits)}</span>
                      </>
                    ) : (
                      'ابحث عن صنف وأضفه بكميته.'
                    )}
                  </p>
                  <Button
                    icon={<TransferIcon />}
                    disabled={!ready}
                    loading={saving}
                    onClick={() => void save()}
                  >
                    سجّل التحويل
                  </Button>
                </div>
                {settings ? (
                  <div className="flex flex-wrap items-end gap-3 rounded-control bg-surface-muted px-4 py-3">
                    <Select
                      label="طريقة التحويل"
                      value={settings.mode}
                      onChange={(e) => void chooseMode(e.target.value as TransferMode)}
                      className="min-w-56"
                    >
                      <option value="auto">تلقائي: بالطريق إن كان للمحل أكثر من فرع</option>
                      <option value="transit">بالطريق دائماً</option>
                      <option value="instant">في خطوة واحدة: يدخل الفرع الآخر فوراً</option>
                    </Select>
                    <p className="min-w-0 flex-1 basis-60 text-sm text-ink-muted">
                      {settings.effective === 'transit'
                        ? 'التحويل الجديد يخرج من الفرع المرسِل ويبقى في الطريق حتى يؤكّد الفرع الآخر ما وصله.'
                        : 'التحويل الجديد يخرج من فرع ويدخل الآخر في اللحظة نفسها.'}
                    </p>
                  </div>
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}
      </SalesPage>
      <Dialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && !cancelBusy && setCancelling(null)}
        title={`ألغِ التحويل ${cancelling?.number ?? ''}`}
        description={cancelling ? `${cancelling.fromBranch} ← ${cancelling.toBranch}` : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCancelling(null)} disabled={cancelBusy}>
              رجوع
            </Button>
            <Button variant="danger" loading={cancelBusy} onClick={() => void confirmCancel()}>
              ألغِ التحويل
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            ترجع كل قطعه إلى الفرع المرسِل بالكلفة التي خرجت بها
            {cancelling ? (
              <>
                {' '}
                (<Amt minor={cancelling.valueMinor} currency={base} />)
              </>
            ) : null}
            ، ويُغلق التحويل. لا يمكن الإلغاء بعد أن يستلمه الفرع الآخر.
          </p>
          <TextField
            label="السبب (اختياري)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value.slice(0, 200))}
          />
          {cancelError ? <Alert tone="error">{cancelError}</Alert> : null}
        </div>
      </Dialog>
    </ReportScreen>
  );
}

/**
 * The sender and the receiver with the arrow between them. Screen readers (and the tests) read the
 * plain «من ← إلى» line; the drawn one is for the eye.
 */
function Route({ from, to }: { from: string; to: string }) {
  return (
    <span className="relative inline-flex items-center whitespace-nowrap">
      <span className="sr-only">{`${from} ← ${to}`}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-2">
        <span>{from}</span>
        <BackIcon size={16} className="rotate-180 text-ink-subtle" />
        <span className="font-semibold">{to}</span>
      </span>
    </span>
  );
}
