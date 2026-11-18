import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  REFUND_METHODS,
  type Approval,
  type RefundMethod,
  type ReturnPayload,
} from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import { buildReturnPayload, defaultRefundMethod, returnableLines } from '@serva/core/sale-return';
import type { OutboxEntry, SyncDocument } from '@serva/sync';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  CardIcon,
  CashIcon,
  cn,
  CustomersIcon,
  EmptyState,
  formatQuantity,
  IconChip,
  OfferIcon,
  PhoneIcon,
  PrintIcon,
  RemoveIcon,
  SearchIcon,
  SalesIcon,
  Skeleton,
  TextField,
  TransferIcon,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import type { InvoiceHit, InvoiceLookup } from '@serva/core/contracts/till';
import type { Catalog } from '../catalog';
import { ExactMoney } from '../ExactMoney';
import { clockText, dateText, isolateSizes } from '../format';
import { fetchPurchases } from '../customers/CustomerHistory';
import { ChoiceGroup, DoneCard, FlowHeader, OptionChip, OptionTile } from '../FlowParts';
import { usePos } from '../services';
import { deviceDocuments, type OpenShift } from '../shift/shift';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { hasBlockedPick, medicineRulesOf, MedicineReturnNote, sealedConfirmed } from './medicineReturn';
import {
  matchesInvoice,
  DAMAGED_REASON,
  returnableSales,
  returnReasons,
  returnWindowOf,
  saleFromServer,
  searchInvoice,
  searchInvoices,
  type ReturnableSale,
} from './returns';

/** The day count as the cashier reads it: «30 يوماً» */
const daysText = (n: number) =>
  n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : `${n} ${n <= 10 ? 'أيام' : 'يوماً'}`;

const REFUND_TEXT: Record<RefundMethod, string> = {
  cash: 'نقداً من الدرج',
  card: 'إلى البطاقة',
  wallet: 'إلى شام كاش',
  transfer: 'بتحويل',
  voucher: 'على قسيمة استبدال',
  account: 'إلى حساب الزبون',
};

const REFUND_ICON: Record<RefundMethod, ReactNode> = {
  cash: <CashIcon />,
  card: <CardIcon />,
  wallet: <PhoneIcon />,
  transfer: <TransferIcon />,
  voucher: <OfferIcon />,
  account: <CustomersIcon />,
};

/** A − or + of the quantity stepper: 48 square, like the cart's (هوية 4 › الكاشير). */
const STEP =
  'grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard enabled:hover:bg-surface-muted enabled:hover:text-ink enabled:active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';

export type SavedReturn = Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;

/** What a return on account of an instalment sale does to its plan, said before the cashier confirms */
function instalmentReturnNote(
  plan: { notesMode?: 'none' | 'each' | 'single' | undefined; count: number } | null | undefined,
): string {
  if (!plan) return '';
  const notes =
    plan.notesMode === 'each'
      ? ` و${String(plan.count)} كمبيالات`
      : plan.notesMode === 'single'
        ? ' وكمبيالتها'
        : '';
  return `هذه الفاتورة بالتقسيط: تُلغى خطة التقسيط${notes}، وما دفعه الزبون يبقى رصيداً له على حسابه. إن أردت إعادته نقداً فاختر «نقداً» بدل «على الحساب». `;
}

/** Every piece of the invoice has come back (display only: the server counts what is left again) */
const allBack = (s: Pick<ReturnableSale, 'sale' | 'returned'>): boolean =>
  returnableLines(s.sale, s.returned).every((l) => l.remainingQty === 0);

/** The invoice's piece names for its row in the list: the first two, then how many more */
const pieceNames = (sale: ReturnableSale['sale']): string => {
  const names = [...new Set(sale.lines.map((l) => l.name))];
  return names.length > 2 ? `${names.slice(0, 2).join('، ')} و${names.length - 2} غيرها` : names.join('، ');
};

const savedRefund = (saved: SavedReturn): RefundMethod =>
  (saved.payload as unknown as ReturnPayload).refunds[0]?.method ?? 'cash';

/**
 * «مرتجع» (08 › مرتجع مبيعات): the cashier finds an invoice of this till from the last week, picks
 * what comes back, the reason and how the money goes back, and saves a return (SRT) that names the
 * invoice. The amounts are the invoice's own (buildReturnPayload), never retyped. A cashier without
 * «المرتجعات» needs a manager's code.
 *
 * An exchange (03 › الملابس: الاستبدال) is a return on «قسيمة استبدال»: no money leaves the drawer,
 * the receipt carries the voucher, and «بيع البديل» goes back to the sale with it at payment.
 */
export function ReturnScreen({
  session,
  catalog,
  staff,
  shift,
  onBack,
  onPrint,
  onExchange,
  startExchange = false,
  initialSearch = '',
  extraInvoices = [],
}: {
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shift: OpenShift;
  onBack: () => void;
  onPrint: (saved: SavedReturn) => void;
  /** Back to the sale with the voucher just issued, to sell the other piece */
  onExchange?: (voucherCode: string | null, cashBackMinor?: number) => void;
  /** Opened from «تبديل»: the exchange choice and its reason start picked */
  startExchange?: boolean;
  /** The rep opens it from a customer's page: the search starts on his name */
  initialSearch?: string;
  /** The rep's morning sheet: his customers' invoices of the last 60 days, found here without the server */
  extraInvoices?: readonly InvoiceLookup[];
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const windowDays = returnWindowOf(settings);
  const REASONS = useMemo(() => returnReasons(settings.sectors), [settings.sectors]);
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState(initialSearch);
  const [picked, setPicked] = useState<ReturnableSale | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  // «العلبة مغلقة»: the sealed-box tick of a medicine line (03 › الصيدليات)
  const [sealed, setSealed] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState<string>(
    startExchange && REASONS.includes('تبديل') ? 'تبديل' : REASONS[0]!,
  );
  // «استبدال»: the piece goes back on a voucher and the sale of the other piece follows at once
  const [exchange, setExchange] = useState(startExchange);
  // «ردّ الفرق نقداً»: the piece's whole value leaves the drawer in cash and the other piece is paid in cash
  const [exchangeCash, setExchangeCash] = useState(false);
  const [remote, setRemote] = useState<{
    sale: ReturnableSale | null;
    note: string | null;
    busy: boolean;
    /** Invoices of the whole store that match the typed name, phone or number end */
    hits?: readonly InvoiceHit[];
  }>({
    sale: null,
    note: null,
    busy: false,
  });
  const [otherReason, setOtherReason] = useState('');
  // «تالفة»: the goods do not go back on the shelf but to the damaged stock (null: it follows the reason)
  const [brokenPicked, setBrokenPicked] = useState<boolean | null>(null);
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [reference, setReference] = useState('');
  const [approving, setApproving] = useState(false);
  // An irreversible refund (to the customer's account) waits for a second tap
  const [confirming, setConfirming] = useState(false);
  // What the customer owes now (the server's word, online only); null while unknown
  const [owed, setOwed] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReturn | null>(null);
  // On a phone the picked invoice and the result sit under the long list: bring them to the top when they appear
  const resultTop = useRef<HTMLDivElement>(null);
  const pickedId = picked?.id ?? null;
  const savedId = saved?.id ?? null;
  useEffect(() => {
    if (pickedId || savedId) resultTop.current?.scrollIntoView?.({ block: 'start' });
  }, [pickedId, savedId]);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [pos.store, tick]);

  const sales = useMemo(() => {
    if (!entries) return [];
    const mine = returnableSales(entries, pos.now(), windowDays);
    const known = new Set(mine.map((s) => s.id));
    const extra = extraInvoices
      .filter((inv) => !known.has(inv.id))
      .map((inv) => saleFromServer(inv, entries, pos.now(), windowDays))
      .filter((s): s is ReturnableSale => s !== null);
    return [...mine, ...extra].sort((a, b) => Date.parse(b.deviceTime) - Date.parse(a.deviceTime));
  }, [entries, pos, windowDays, extraInvoices]);
  const online = pos.online();
  const shown = sales.filter((s) => matchesInvoice(s, search, catalog.customers)).slice(0, 30);

  // The store's newest invoices (other tills too), shown when the screen opens and nothing is typed
  const [recent, setRecent] = useState<readonly InvoiceHit[]>([]);
  useEffect(() => {
    const token = pos.device.token;
    if (!token || !pos.online()) return;
    let alive = true;
    void searchInvoices('', windowDays, token, pos.fetch).then((list) => alive && setRecent(list ?? []));
    return () => {
      alive = false;
    };
  }, [pos, windowDays, tick]);
  const recentOther0 = recent.filter((h) => !sales.some((s) => s.number === h.number)).slice(0, 8);
  const recentOther = search.trim() === '' ? recentOther0 : [];
  const storeList: readonly InvoiceHit[] = remote.hits?.length ? remote.hits : recentOther;
  // This device's invoices and the store's, one list, the newest first (a store invoice already here shows once)
  const rows = useMemo(() => {
    const list: (
      { kind: 'local'; at: number; sale: ReturnableSale } | { kind: 'hit'; at: number; hit: InvoiceHit }
    )[] = [
      ...shown.map((sale) => ({ kind: 'local' as const, at: Date.parse(sale.deviceTime), sale })),
      // An invoice of another till found by its number stays in the list once it is chosen
      ...(remote.sale && !shown.some((x) => x.number === remote.sale!.number)
        ? [{ kind: 'local' as const, at: Date.parse(remote.sale.deviceTime), sale: remote.sale }]
        : []),
      ...storeList
        .filter((h) => !shown.some((x) => x.number === h.number))
        .map((hit) => ({ kind: 'hit' as const, at: Date.parse(hit.deviceTime), hit })),
    ];
    // One row per invoice: the picked one (a store invoice opened from the list) is never listed twice
    const seen = new Set<string>();
    return list
      .filter((row) => {
        const number = row.kind === 'local' ? row.sale.number : row.hit.number;
        if (seen.has(number)) return false;
        seen.add(number);
        return true;
      })
      .sort((x, y) => y.at - x.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((x) => x.id).join(), storeList, remote.sale]);

  // Nothing here matches what is typed: the whole store is searched by itself, no second tap
  const typedNow = search.trim();
  const searchStoreRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (typedNow.length < 2 || entries === null || shown.length > 0 || !pos.online()) return;
    const timer = setTimeout(() => void searchStoreRef.current(), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedNow, entries, shown.length]);

  // Some match here: the store's other matches join the same list (newest first), without opening any
  useEffect(() => {
    const token = pos.device.token;
    if (typedNow.length < 3 || shown.length === 0 || picked || !token || !pos.online()) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchInvoices(typedNow, windowDays, token, pos.fetch).then((hits) => {
        if (alive && hits && hits.length > 0) setRemote((r) => (r.busy ? r : { ...r, hits }));
      });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [typedNow, shown.length, picked, pos, windowDays]);

  // The picked invoice as it is now (a return saved here a moment ago counts)
  const current = picked ? (sales.find((s) => s.id === picked.id) ?? picked) : null;
  const isExchange = exchange && current !== null;
  const lines = current ? returnableLines(current.sale, current.returned) : [];
  const medicineRules = useMemo(
    () => (current ? medicineRulesOf(current.sale, catalog, settings.pharmacy) : new Map()),
    [current, catalog, settings.pharmacy],
  );
  const picks = Object.entries(qty)
    .map(([lineNo, q]) => ({ saleLineNo: Number(lineNo), qty: q }))
    .filter((p) => p.qty > 0);
  const why = reason === 'other' ? otherReason.trim() : reason;
  const broken = brokenPicked ?? reason === DAMAGED_REASON;
  const needsReference = method !== 'cash' && method !== 'voucher' && method !== 'account';

  const draft = useMemo((): ReturnPayload | null => {
    if (!current || picks.length === 0) return null;
    try {
      return buildReturnPayload({
        sale: current.sale,
        saleId: current.id,
        saleNumber: current.number,
        shiftId: shift.id,
        cashierId: session.userId,
        reason: why || '—',
        picks,
        returned: current.returned,
        refundMethod: method,
        reference: reference.trim() || null,
        cashStepMinor: settings.cashRoundingSteps[current.sale.currency] ?? 0,
        damaged: broken,
      });
    } catch {
      return null;
    }
  }, [current, picks, shift.id, session.userId, why, method, reference, settings.cashRoundingSteps, broken]);

  // A damaged or expired box is never «sealed»: that reason does not ask for the tick
  const damaged = reason === DAMAGED_REASON;
  const sealedOk = damaged || sealedConfirmed(picks, medicineRules, sealed);
  const ready =
    draft !== null &&
    why.length > 0 &&
    (!needsReference || reference.trim().length > 0) &&
    sealedOk &&
    !hasBlockedPick(picks, medicineRules);
  // Why the button is off, said under it
  const notReadyBecause = ready
    ? null
    : picks.length === 0
      ? 'اختر الكمية المراد إرجاعها من سطر واحد على الأقل.'
      : hasBlockedPick(picks, medicineRules)
        ? 'سطر محدد لا يقبله المحل مرتجعاً. أزل كميته.'
        : why.length === 0
          ? 'اكتب سبب الإرجاع.'
          : !sealedOk
            ? `أكّد أن العلبة مغلقة وسليمة، أو اختر السبب «${DAMAGED_REASON}».`
            : needsReference && reference.trim().length === 0
              ? 'اكتب رقم المرجع أو الموافقة.'
              : 'راجع الأسطر والكميات.';
  const canRefund = session.permissions.has('sale.refund');
  const accountCustomer = current?.sale.customerId ?? null;
  useEffect(() => {
    setConfirming(false);
  }, [method, current?.id, draft?.totals.totalMinor]);
  useEffect(() => {
    setOwed(null);
    const token = pos.device.token;
    if (method !== 'account' || !accountCustomer || !token || !pos.online()) return;
    let alive = true;
    void fetchPurchases(accountCustomer, token, pos.fetch).then(
      (got) => alive && setOwed(got?.balanceMinor ?? null),
    );
    return () => {
      alive = false;
    };
  }, [method, accountCustomer, pos]);

  /** The invoice of another till or branch: asked of the server, by number or by the receipt's barcode */
  async function findInStore() {
    const typed = search.trim();
    if (!typed) return;
    const token = pos.device.token;
    if (!pos.online() || !token) {
      setRemote({ sale: null, busy: false, note: 'لا إنترنت الآن: تظهر فواتير هذا الجهاز فقط.' });
      return;
    }
    setRemote({ sale: null, busy: true, note: null });
    const result = await searchInvoice(typed, token, pos.fetch);
    if (result.found === null) {
      if (result.reason === 'offline') {
        setRemote({
          sale: null,
          busy: false,
          note: 'تعذّر الوصول إلى المحل الآن: تظهر فواتير هذا الجهاز فقط.',
        });
        return;
      }
      // Not a whole number: look for the customer's name, phone or the end of the number across the store
      const hits = await searchInvoices(typed, windowDays, token, pos.fetch);
      if (hits && hits.length > 0) {
        setRemote({ sale: null, busy: false, note: null, hits });
        return;
      }
      setRemote({
        sale: null,
        busy: false,
        note:
          hits === null
            ? 'تعذّر الوصول إلى المحل الآن: تظهر فواتير هذا الجهاز فقط.'
            : `لا فاتورة في المحل تطابق البحث في آخر ${daysText(windowDays)}.`,
      });
      return;
    }
    const sale = saleFromServer(result.found, entries ?? [], pos.now(), windowDays);
    if (!sale) {
      setRemote({
        sale: null,
        busy: false,
        note: `الفاتورة أقدم من ${daysText(windowDays)}، فلا يُقبل مرتجعها.`,
      });
      return;
    }
    setRemote((r) => ({ ...r, sale, busy: false, note: null }));
    choose(sale);
  }

  // Never once an invoice is picked: it would start the pick over
  searchStoreRef.current = () => (picked ? Promise.resolve() : findInStore());

  /** One of the store's matching invoices: the full invoice is fetched by its number, then chosen */
  async function pickHit(hit: InvoiceHit) {
    const token = pos.device.token;
    if (!token) return;
    setRemote((r) => ({ ...r, busy: true }));
    const result = await searchInvoice(hit.number, token, pos.fetch);
    const sale = result.found ? saleFromServer(result.found, entries ?? [], pos.now(), windowDays) : null;
    if (!sale) {
      setRemote({ sale: null, busy: false, note: 'تعذّر فتح هذه الفاتورة الآن. حاول مرة أخرى.' });
      return;
    }
    // The list stays as it was: choosing an invoice never empties it
    setRemote((r) => ({ ...r, sale, busy: false, note: null }));
    choose(sale);
  }

  function choose(sale: ReturnableSale) {
    setPicked(sale);
    setQty({});
    setSealed({});
    setMethod(exchange ? (exchangeCash ? 'cash' : 'voucher') : defaultRefundMethod(sale.sale));
    setReference('');
    setError(null);
    setSaved(null);
  }

  async function record(approval: Approval | null) {
    if (!draft || !current) return;
    setApproving(false);
    setSaving(true);
    setError(null);
    try {
      const entry = await pos.save({
        type: 'return',
        payload: { ...draft, reason: why, approval } as unknown as Record<string, unknown>,
        deps: [current.id],
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const doc: SavedReturn = {
        id: entry.doc.id,
        number: entry.doc.number,
        deviceTime: entry.doc.deviceTime,
        payload: entry.doc.payload,
      };
      setSaved(doc);
      // An invoice found on the server is not in this till's list: what it just gave back is added to what it shows
      const added = draft.lines.map((l) => ({ saleLineNo: l.saleLineNo, qty: l.qty, ...l.refund }));
      setPicked((p) => (p && p.id === current.id ? { ...p, returned: [...p.returned, ...added] } : p));
      setQty({});
      setTick((t) => t + 1);
      onPrint(doc);
      if (isExchange && doc.number && onExchange)
        onExchange(
          method === 'voucher' ? doc.number : null,
          method === 'voucher' ? undefined : (draft.refunds[0]?.amountMinor ?? draft.totals.totalMinor),
        );
    } catch {
      setError('لم يُسجَّل المرتجع. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  const refundMethods = current
    ? [
        'cash',
        // What was on account (آجل) can go back to the customer's account, when the sale names them
        ...current.sale.payments.map((p) =>
          (p.method === 'credit' || p.method === 'cheque') && current.sale.customerId ? 'account' : p.method,
        ),
        'voucher',
      ].filter(
        (m, i, all): m is RefundMethod =>
          (REFUND_METHODS as readonly string[]).includes(m) && all.indexOf(m) === i,
      )
    : [];

  return (
    <div className="flex w-full max-w-7xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<UndoIcon size={24} />}
        title={startExchange ? 'تبديل صنف' : 'مرتجع'}
        description={`${startExchange ? 'أرجِع ما لا يناسب الزبون ثم بِعه غيره. ' : ''}اختر فاتورة من آخر ${daysText(windowDays)}، من أي جهاز في المحل، ثم ما يرجع منها. المبلغ من الفاتورة نفسها.`}
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section
          aria-label="الفواتير"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto"
        >
          <TextField
            label="رقم الفاتورة"
            hint={
              online
                ? 'اكتب آخر أرقام الفاتورة أو اسم الزبون أو جواله، أو امسح باركود الإيصال. إن لم تظهر هنا فابحث في المحل كله.'
                : 'اكتب آخر أرقام الفاتورة أو اسم الزبون أو جواله. بلا إنترنت: فواتير هذا الجهاز فقط'
            }
            dir="ltr"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value.slice(0, 40));
              setRemote({ sale: null, busy: false, note: null });
            }}
            onKeyDown={(e) => {
              // A scanner types the barcode and presses Enter: the whole number goes to the store
              if (e.key === 'Enter') {
                e.preventDefault();
                // An invoice of this device that matches is never asked of the server
                const exact = shown.find((s) => s.number.toUpperCase() === search.trim().toUpperCase());
                if (exact) choose(exact);
                else if (shown.length === 0) void findInStore();
              }
            }}
            inputClassName="num"
            startAdornment={<SearchIcon className="ms-4 shrink-0" />}
          />
          {search.trim() && shown.length === 0 ? (
            <Button
              variant="secondary"
              icon={<SearchIcon />}
              loading={remote.busy}
              onClick={() => void findInStore()}
            >
              ابحث في المحل كله
            </Button>
          ) : null}
          {remote.note ? <Alert tone="info">{remote.note}</Alert> : null}
          {entries === null ? (
            <div aria-hidden="true" className="flex flex-col gap-2 py-1">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-control" />
              ))}
            </div>
          ) : null}
          {entries &&
          shown.length === 0 &&
          !current &&
          !remote.note &&
          !remote.busy &&
          storeList.length === 0 &&
          !(remote.hits && remote.hits.length > 0) ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا فواتير على هذا الجهاز تطابق البحث.</p>
          ) : null}
          {rows.length > 0 ? (
            <ul aria-label="فواتير المحل" className="-mx-1 flex flex-col gap-1 px-1 pb-4 pt-0.5">
              {rows.map((row) => {
                if (row.kind === 'hit') {
                  const h = row.hit;
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        disabled={remote.busy}
                        onClick={() => void pickHit(h)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-control border border-transparent px-3 py-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <bdi dir="ltr" className="num font-semibold text-ink [overflow-wrap:anywhere]">
                            {h.number}
                          </bdi>
                          <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                            <span className="num">
                              {dateText(row.at, digits)} ، {clockText(row.at, digits)}
                            </span>
                            {h.customerName ? <bdi>{h.customerName}</bdi> : null}
                          </span>
                        </span>
                        <ExactMoney
                          minor={h.totalMinor}
                          currency={h.currency}
                          className="shrink-0 font-bold text-ink"
                        />
                      </button>
                    </li>
                  );
                }
                const s = row.sale;
                const at = row.at;
                const selected = current?.id === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => choose(s)}
                      className={cn(
                        'flex min-h-14 w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-start transition-colors duration-120 ease-standard',
                        selected
                          ? 'border-brand bg-brand-soft/60 ring-4 ring-brand/10'
                          : 'border-transparent hover:bg-surface-muted',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <bdi dir="ltr" className="num font-semibold text-ink [overflow-wrap:anywhere]">
                          {s.number}
                        </bdi>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                          <span className="num">
                            {dateText(at, digits)} ، {clockText(at, digits)}
                          </span>
                          {(() => {
                            // The customer of an invoice made on this device: the name it carries, or the one the till knows
                            const name =
                              s.sale.customerName ??
                              catalog.customers.find((c) => c.id === s.sale.customerId)?.name;
                            return name ? <bdi className="font-semibold text-ink">{name}</bdi> : null;
                          })()}
                          {s.returned.length > 0 ? (
                            <span className="text-warning-ink">
                              · {allBack(s) ? 'رجعت كلها' : 'رجع منها شيء'}
                            </span>
                          ) : (
                            ''
                          )}
                        </span>
                        {/* The pieces, so «الفستان الأزرق» can be found without opening each invoice */}
                        <span className="truncate text-xs text-ink-muted">
                          <bdi>{pieceNames(s.sale)}</bdi>
                        </span>
                      </span>
                      <ExactMoney
                        minor={s.sale.totals.totalMinor}
                        currency={s.sale.currency}
                        className="shrink-0 font-bold text-ink"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
        {/* The result's own box carries the mark: a hidden span in the grid sat at the page's top, above the list */}
        <div ref={resultTop} className="min-w-0 scroll-mt-4">
          {!current ? (
            <EmptyState
              icon={UndoIcon}
              title="اختر فاتورة"
              description="تظهر أصنافها هنا مع الكمية التي ما زالت ترجع."
              className="min-h-80 justify-center"
            />
          ) : saved ? (
            <DoneCard
              label="سُجّل المرتجع"
              title="سُجّل المرتجع"
              actions={
                <>
                  {savedRefund(saved) === 'voucher' && onExchange && saved.number ? (
                    <Button onClick={() => onExchange(saved.number!)}>بيع البديل بالقسيمة</Button>
                  ) : null}
                  {savedRefund(saved) === 'cash' && saved.payload.reason === 'تبديل' && onExchange ? (
                    <Button onClick={() => onExchange(null)}>بيع البديل نقداً</Button>
                  ) : null}
                  <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
                    اطبع الإيصال مرة أخرى
                  </Button>
                  {/* Nothing left to take back from this invoice: no offer of another return */}
                  {lines.some(
                    (l) => l.remainingQty > 0 && medicineRules.get(l.saleLineNo)?.kind !== 'blocked',
                  ) ? (
                    <Button variant="secondary" onClick={() => setSaved(null)}>
                      مرتجع آخر من نفس الفاتورة
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={onBack}>
                    ارجع للبيع
                  </Button>
                </>
              }
            >
              <p className="text-lg text-ink">
                <bdi dir="ltr" className="num font-semibold">
                  {saved.number}
                </bdi>{' '}
                · رُدّ{' '}
                <ExactMoney
                  minor={
                    (saved.payload as unknown as ReturnPayload).refunds[0]?.amountMinor ??
                    (saved.payload as unknown as ReturnPayload).totals.totalMinor
                  }
                  currency={(saved.payload as unknown as ReturnPayload).currency}
                  className="font-bold"
                />{' '}
                {REFUND_TEXT[savedRefund(saved)]}
              </p>
              {(saved.payload as unknown as ReturnPayload).refunds[0]?.roundingMinor ? (
                <p className="text-ink-muted">
                  قيمة البضاعة{' '}
                  <ExactMoney
                    minor={(saved.payload as unknown as ReturnPayload).totals.totalMinor}
                    currency={(saved.payload as unknown as ReturnPayload).currency}
                  />{' '}
                  والفرق تقريب النقد
                </p>
              ) : null}
              {savedRefund(saved) === 'voucher' ? (
                <p className="max-w-md text-ink-muted">
                  القسيمة برقم المرتجع، مطبوعة على الإيصال. تُصرف على أي جهاز في المحل.
                </p>
              ) : null}
            </DoneCard>
          ) : (
            <section
              aria-label="ما يرجع"
              className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
            >
              <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1">
                <div className="flex flex-wrap items-center gap-3">
                  <IconChip>
                    <SalesIcon />
                  </IconChip>
                  <h2 className="min-w-0 flex-1 text-lg font-semibold wrap-anywhere text-ink">
                    الفاتورة{' '}
                    <bdi dir="ltr" className="num">
                      {current.number}
                    </bdi>
                  </h2>
                  {allBack(current) ? <Badge>رجعت كلها</Badge> : null}
                  <ExactMoney
                    minor={current.sale.totals.totalMinor}
                    currency={current.sale.currency}
                    className="text-sm font-semibold text-ink-muted"
                  />
                </div>
                <ul className="flex flex-col divide-y divide-line border-t border-line">
                  {lines.map((line) => {
                    const q = qty[line.saleLineNo] ?? 0;
                    const set = (next: number) =>
                      setQty((all) => ({
                        ...all,
                        [line.saleLineNo]: Math.max(0, Math.min(line.remainingQty, next)),
                      }));
                    return (
                      <li
                        key={line.saleLineNo}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <span className="flex min-w-40 flex-1 flex-col gap-0.5">
                          <span className="font-semibold text-ink">{isolateSizes(line.name)}</span>
                          <span className="num text-sm text-ink-muted">
                            بيع {formatQuantity(line.soldQty, digits)}
                            {line.returnedQty > 0 ? ` · رجع ${formatQuantity(line.returnedQty, digits)}` : ''}
                          </span>
                        </span>
                        {line.remainingQty === 0 || medicineRules.get(line.saleLineNo)?.kind === 'blocked' ? (
                          <Badge>{line.remainingQty === 0 ? 'رجع كله' : 'لا يُرجَع'}</Badge>
                        ) : (
                          <span
                            className="flex items-center gap-2"
                            role="group"
                            aria-label={`كمية ${line.name}`}
                          >
                            <span className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1">
                              <button
                                type="button"
                                aria-label={`أنقص ${line.name}`}
                                onClick={() => set(q - 1000)}
                                disabled={q === 0}
                                className={STEP}
                              >
                                <RemoveIcon />
                              </button>
                              <output
                                className={cn(
                                  'num grid min-w-14 place-items-center border-x border-line px-2 text-lg font-bold',
                                  q > 0 ? 'text-brand-ink' : 'text-ink',
                                )}
                                aria-live="polite"
                              >
                                {formatQuantity(q, digits)}
                              </output>
                              <button
                                type="button"
                                aria-label={`زد ${line.name}`}
                                onClick={() =>
                                  set(q + 1000 > line.remainingQty ? line.remainingQty : q + 1000)
                                }
                                disabled={q >= line.remainingQty}
                                className={STEP}
                              >
                                <AddIcon />
                              </button>
                            </span>
                            <Button variant="ghost" onClick={() => set(line.remainingQty)}>
                              الكل
                            </Button>
                          </span>
                        )}
                        {line.remainingQty > 0 &&
                        medicineRules.has(line.saleLineNo) &&
                        !(damaged && medicineRules.get(line.saleLineNo)!.kind === 'sealed') ? (
                          <MedicineReturnNote
                            rule={medicineRules.get(line.saleLineNo)!}
                            name={line.name}
                            picked={q > 0}
                            confirmed={sealed[line.saleLineNo] === true}
                            onConfirm={(yes) => setSealed((all) => ({ ...all, [line.saleLineNo]: yes }))}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <ChoiceGroup label="ماذا يريد الزبون؟" className="flex flex-wrap gap-2">
                  <OptionChip
                    selected={!exchange}
                    onClick={() => {
                      setExchange(false);
                      if (current) setMethod(defaultRefundMethod(current.sale));
                    }}
                  >
                    رد المبلغ
                  </OptionChip>
                  <OptionChip
                    selected={exchange}
                    onClick={() => {
                      setExchange(true);
                      setMethod(exchangeCash ? 'cash' : 'voucher');
                      if (REASONS.includes('تبديل')) setReason('تبديل');
                    }}
                  >
                    استبدال بقطعة أخرى
                  </OptionChip>
                </ChoiceGroup>
                <ChoiceGroup label="السبب" className="flex flex-wrap gap-2">
                  {[...REASONS, 'other' as const].map((r) => (
                    <OptionChip key={r} selected={reason === r} onClick={() => setReason(r)}>
                      {r === 'other' ? 'سبب آخر' : r}
                    </OptionChip>
                  ))}
                </ChoiceGroup>
                {reason === 'other' ? (
                  <TextField
                    label="السبب"
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value.slice(0, 200))}
                  />
                ) : null}
                <ChoiceGroup label="القطع المرتجعة" className="flex flex-wrap gap-2">
                  <OptionChip selected={!broken} onClick={() => setBrokenPicked(false)}>
                    سليمة: تعود إلى الرف
                  </OptionChip>
                  <OptionChip selected={broken} onClick={() => setBrokenPicked(true)}>
                    تالفة: لا تُباع
                  </OptionChip>
                </ChoiceGroup>
                {broken ? (
                  <p className="text-xs text-ink-muted">
                    تذهب القطع إلى «البضاعة التالفة» ولا تُحسب من مخزون البيع، وتبقى بكلفتها حتى تُرجَع للمورد
                    أو تُشطب.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
                {exchange ? (
                  <>
                    <ChoiceGroup label="إن كانت البديلة أرخص" className="flex flex-wrap gap-2">
                      <OptionChip
                        selected={!exchangeCash}
                        onClick={() => {
                          setExchangeCash(false);
                          setMethod('voucher');
                        }}
                      >
                        يبقى الباقي على قسيمة
                      </OptionChip>
                      <OptionChip
                        selected={exchangeCash}
                        onClick={() => {
                          setExchangeCash(true);
                          setMethod('cash');
                        }}
                      >
                        ردّ الفرق نقداً
                      </OptionChip>
                    </ChoiceGroup>
                    <Alert tone="info">
                      {exchangeCash
                        ? 'تُرَدّ للزبون قيمة القطعة كاملة نقداً، ثم يدفع ثمن القطعة الأخرى كاملاً نقداً. المهم أن الفرق وحده هو ما يبقى في الدرج.'
                        : 'تُسجَّل القطعة مرتجعة على قسيمة بقيمتها، ثم تُباع القطعة الأخرى بالقسيمة: يدفع الزبون الفرق فقط، وإن كانت أرخص يبقى الباقي له على القسيمة.'}
                    </Alert>
                  </>
                ) : (
                  <ChoiceGroup label="طريقة الرد" className="grid gap-2">
                    {refundMethods.map((m) => (
                      <OptionTile
                        key={m}
                        selected={method === m}
                        onClick={() => setMethod(m)}
                        icon={REFUND_ICON[m]}
                        title={REFUND_TEXT[m]}
                      />
                    ))}
                  </ChoiceGroup>
                )}
                {current?.sale.payments.some((p) => p.method === 'cheque') ? (
                  <Alert tone="info">
                    دُفعت هذه الفاتورة بشيك. الشيك نفسه يبقى كما هو عند البنك، والمرتجع لا يخرج من الدرج إلا
                    إن اخترت النقد بنفسك.
                  </Alert>
                ) : null}
                {needsReference ? (
                  <TextField
                    label="رقم العملية"
                    hint="من جهاز البطاقة أو من التطبيق"
                    dir="ltr"
                    value={reference}
                    onChange={(e) => setReference(e.target.value.slice(0, 64))}
                  />
                ) : null}
                <div
                  role="status"
                  aria-label="المبلغ المردود"
                  className="flex flex-col gap-0.5 rounded-control bg-surface-total px-4 py-3"
                >
                  <span className="text-sm font-semibold text-ink-muted">
                    {exchange && !exchangeCash
                      ? 'قيمة القطعة المرتجعة'
                      : method === 'voucher'
                        ? 'مبلغ القسيمة'
                        : method === 'account'
                          ? owed === null
                            ? 'يُسجَّل على حساب الزبون'
                            : owed > 0
                              ? 'يُحسم من دين الزبون'
                              : 'يُضاف رصيداً للزبون'
                          : 'المبلغ المردود'}
                  </span>
                  <ExactMoney
                    minor={draft?.refunds[0]?.amountMinor ?? draft?.totals.totalMinor ?? 0}
                    currency={current.sale.currency}
                    className="text-kpi font-bold tracking-tight text-ink"
                    unitClassName="text-base font-semibold text-ink-subtle"
                  />
                  {draft?.refunds[0]?.roundingMinor ? (
                    <span className="text-sm text-ink-muted">
                      قيمة البضاعة{' '}
                      <ExactMoney minor={draft.totals.totalMinor} currency={current.sale.currency} /> · تقريب
                      النقد
                    </span>
                  ) : null}
                </div>
                {method === 'cash' &&
                current.sale.payments.some(
                  (p) => p.method === 'cash' && p.currency !== current.sale.currency,
                ) ? (
                  // A refund leaves in the invoice's own currency; the dollar drawer has no refund method yet
                  <Alert tone="info">
                    {current.sale.payments.every(
                      (p) => p.method === 'cash' && p.currency !== current.sale.currency,
                    )
                      ? 'دُفعت هذه الفاتورة بالدولار. الرد يكون بالليرة بسعر الفاتورة، من درج الليرة.'
                      : 'دُفعت هذه الفاتورة بأكثر من طريقة، وجزء منها بالدولار. الرد النقدي يكون بالليرة بسعر الفاتورة، من درج الليرة.'}
                  </Alert>
                ) : null}
                {error ? <Alert tone="error">{error}</Alert> : null}
                {approving ? (
                  <ManagerCode
                    staff={staff}
                    permission="sale.refund"
                    reason={
                      method === 'voucher'
                        ? 'المرتجع يُصدر قسيمة بمبلغه، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                        : method === 'account'
                          ? 'المرتجع يخفّض دين الزبون، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                          : 'المرتجع يُخرج مالاً، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                    }
                    onApproved={(approval) => void record(approval)}
                    onCancel={() => setApproving(false)}
                  />
                ) : (
                  <>
                    {confirming ? (
                      <Alert tone="warning">
                        {`سيُسجَّل المرتجع على حساب الزبون ولا يخرج من الدرج، ولا يمكن التراجع عنه بعد الحفظ. ${
                          current?.sale.payments.some((p) => p.method === 'cheque')
                            ? 'الشيك نفسه يبقى كما هو. '
                            : ''
                        }${instalmentReturnNote(current?.sale.installmentPlan)}اضغط «نعم، سجّل» للتأكيد.`}
                      </Alert>
                    ) : null}
                    <Button
                      size="lg"
                      fullWidth
                      icon={<UndoIcon />}
                      disabled={!ready || saving}
                      onClick={() => {
                        if (method === 'account' && !confirming) return setConfirming(true);
                        if (canRefund) void record(null);
                        else setApproving(true);
                      }}
                    >
                      {confirming ? 'نعم، سجّل' : exchange ? 'سجّل وبِع البديل' : 'سجّل المرتجع'}
                    </Button>
                    {notReadyBecause ? (
                      <p role="status" className="text-center text-sm text-ink-muted">
                        {notReadyBecause}
                      </p>
                    ) : null}
                    {confirming ? (
                      <Button variant="ghost" size="lg" fullWidth onClick={() => setConfirming(false)}>
                        لا، ارجع
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
