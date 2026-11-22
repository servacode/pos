import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import type { CashMovementKind, CashMovementPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import type { OutboxEntry } from '@serva/sync';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  CashIcon,
  DataTable,
  EmptyState,
  EyeOffIcon,
  IconChip,
  Keypad,
  LockIcon,
  Money,
  PrintIcon,
  cn,
  RemoveIcon,
  ReportsIcon,
  SalesIcon,
  StatusChip,
  TextField,
  TransferIcon,
  useDigits,
  WarningIcon,
  type DataColumn,
} from '@serva/ui';
import type { TillSettings } from '@serva/core/contracts/till';
import type { Catalog } from '../catalog';
import { PrintSheet, usePrint } from '../../lib/print';
import { clockText, counted, INVOICES } from '../format';
import { ChoiceGroup, FlowHeader, OptionTile } from '../FlowParts';
import { ExactMoney } from '../ExactMoney';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { DrawerCounter, drawerName, totalCount, useCountKeypad } from './DrawerCounter';
import { MOVEMENT_NAMES, ZReport } from './ZReport';
import {
  cashMovementPayload,
  closeDrawer,
  countTotal,
  deviceDocuments,
  LAST_CLOSED_KEY,
  netMethodRows,
  refundVouchers,
  returnedGoodsIn,
  shiftActivity,
  shiftClosePayload,
  shiftKey,
  shiftOpenPayload,
  type DrawerCount,
  type OpenShift,
  type ShiftActivity,
} from './shift';

/** The last opening count of each drawer, to notice a count that jumps */
const LAST_OPENING_KEY = 'lastOpeningCount';
/** An opening count more than this many times the last one is asked about */
const OPENING_JUMP = 20;
/** Above this (in minor units) no opening count is believable, whatever the history: 100 million in the base currency, 500,000 in a foreign drawer */
const ABSURD_OPENING_MINOR = 10_000_000_000;
const ABSURD_FOREIGN_OPENING_MINOR = 50_000_000;
/** A foreign drawer counted above this (5,000 in a currency of 2 decimals) is asked about at closing */
const ODD_FOREIGN_MINOR = 500_000;

/** The drawers of the store: its base currency and each enabled one with a rate (10 › درج لكل عملة). */
export function drawerCurrencies(catalog: Catalog): CurrencyCode[] {
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const foreign = settings.enabledCurrencies.filter(
    (c) => c !== base && catalog.rates.some((r) => r.unit === c || r.quote === c),
  );
  return [base, ...foreign];
}

function useBusinessDate(catalog: Catalog) {
  const pos = usePos();
  const settings = catalog.settings!;
  return () => businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff);
}

/**
 * The counted drawers and the keypad that types into them (kit cashier/ShiftOpen, ShiftClose): the
 * drawers side by side, and beside them a panel with the live total, the keypad and the next step.
 */
function CountLayout({
  counts,
  setCounts,
  till,
  intro,
  children,
}: {
  counts: DrawerCount[];
  /** The store's till settings (its own banknote values) */
  till?: TillSettings | null;
  setCounts: (update: (list: DrawerCount[]) => DrawerCount[]) => void;
  /** What sits above the drawers, e.g. the blind-count note */
  intro?: ReactNode;
  /** The panel's end: errors and the button */
  children: ReactNode;
}) {
  const keypad = useCountKeypad(counts, setCounts, till);
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start gap-6',
        // One drawer: the count, the keys and the button in one centred column, not split across a wide page
        counts.length === 1 ? 'mx-auto w-full max-w-md' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]',
      )}
    >
      <div className="flex flex-col gap-4">
        {intro}
        <div className={cn('grid grid-cols-1 gap-4', counts.length > 1 && 'xl:grid-cols-2')}>
          {counts.map((count, i) => (
            <DrawerCounter
              key={count.currency}
              count={count}
              till={till}
              onChange={(next) => setCounts((list) => list.map((c, j) => (j === i ? next : c)))}
              active={keypad.activeIn(count.currency)}
              fraction={keypad.fractionIn(count.currency)}
              onActivate={(key) => keypad.activate(count.currency, key)}
            />
          ))}
        </div>
      </div>
      {/* A phone: the panel's parts join the page itself, so its button can stay in view (sticky) at the screen's end */}
      <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 max-lg:contents lg:sticky lg:top-0">
        <div
          className={cn(
            'flex flex-col gap-1 rounded-control bg-surface-total px-4 py-3 max-lg:hidden',
            // One drawer: its own total (the field or the header) already says it
            counts.length === 1 && 'sr-only',
          )}
        >
          <span className="text-sm font-semibold text-ink-muted">المجموع الحي</span>
          {counts.map((c) => (
            <Money
              key={c.currency}
              minor={countTotal(c)}
              currency={c.currency}
              className="text-kpi font-bold tracking-tight text-ink"
              unitClassName="text-base font-semibold text-ink-subtle"
            />
          ))}
        </div>
        {/* The phone's own keyboard types the amount; the pad is for a till with a mouse or a wide screen */}
        <div className="flex flex-col gap-2 max-lg:hidden">
          <Keypad label="لوحة العدّ" {...keypad.keypad} />
        </div>
        <div className="flex flex-col gap-4 max-lg:sticky max-lg:-bottom-6 max-lg:z-10 max-lg:-mx-2 max-lg:border-t max-lg:border-line max-lg:bg-canvas max-lg:p-3">
          {/* A phone: the live total rides in the sticky bar, so the button never hides it */}
          {counts.length > 1 ? (
            <p
              aria-hidden="true"
              className="flex flex-wrap items-baseline gap-x-3 text-sm text-ink-muted lg:hidden"
            >
              المجموع الحي
              {counts.map((c) => (
                <Money
                  key={c.currency}
                  minor={countTotal(c)}
                  currency={c.currency}
                  className="font-bold text-ink"
                />
              ))}
            </p>
          ) : null}
          {children}
        </div>
      </aside>
    </div>
  );
}

/**
 * «افتح الوردية» (kit cashier/ShiftOpen): the cashier counts each drawer before the first sale,
 * and the device saves shift_open (SFT) with the opening count.
 */
export function ShiftOpenScreen({
  session,
  catalog,
  onOpened,
}: {
  session: StaffSession;
  catalog: Catalog;
  onOpened: (shift: OpenShift) => void;
}) {
  const pos = usePos();
  const mode = catalog.settings!.shiftMode;
  const businessDate = useBusinessDate(catalog);
  // One amount per drawer to begin with; counting note by note is one tap away («عدّ تفصيلي»)
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(totalCount));
  const [saving, setSaving] = useState(false);
  const [warn, setWarn] = useState(false);
  const [oddDrawers, setOddDrawers] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One click = one shift: a second click while the first is still saving does nothing
  const inFlight = useRef(false);

  async function open(confirmed = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await openOnce(confirmed);
    } finally {
      inFlight.current = false;
    }
  }

  async function openOnce(confirmed: boolean) {
    setError(null);
    // This cashier already has an open shift on this device: carry on with it, never open another
    const existing = await pos.local.get<OpenShift>(shiftKey(mode, session.userId));
    if (existing) {
      onOpened(existing);
      return;
    }
    // A count far above the usual opening is most likely a slipped key: ask once before it is saved
    if (!confirmed) {
      const usual = await pos.local.get<Record<string, number>>(LAST_OPENING_KEY);
      const odds = counts.filter((c) => {
        const total = countTotal(c);
        const before = usual?.[c.currency] ?? 0;
        const absurd =
          c.currency === catalog.settings?.baseCurrency ? ABSURD_OPENING_MINOR : ABSURD_FOREIGN_OPENING_MINOR;
        return total > absurd || (before > 0 && total > before * OPENING_JUMP);
      });
      if (odds.length > 0) {
        setOddDrawers(odds.map((c) => drawerName(c.currency)).join(' و'));
        setWarn(true);
        return;
      }
    }
    setWarn(false);
    setSaving(true);
    try {
      const lastClosed = await pos.local.get<string>(LAST_CLOSED_KEY);
      const payload = shiftOpenPayload(session.userId, mode, lastClosed, counts);
      const entry = await pos.save({
        type: 'shift_open',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const key = shiftKey(mode, session.userId);
      const shift: OpenShift = {
        key,
        id: entry.doc.id,
        number: entry.doc.number!,
        openedBy: session.userId,
        openedByName: session.fullName,
        openedAt: pos.now(),
        mode: payload.mode,
        opening: payload.opening,
      };
      await pos.local.set(key, shift);
      await pos.local.set(
        LAST_OPENING_KEY,
        Object.fromEntries(counts.map((c) => [c.currency, countTotal(c)])),
      );
      onOpened(shift);
    } catch {
      setSaving(false);
      setError('لم تُفتح الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <FlowHeader
        icon={<CashIcon size={24} />}
        title="افتح الوردية"
        description="اكتب كم نقداً في الدرج الآن، قبل أول بيع. يُحفظ على الجهاز ويُرسل وحده."
      />
      <CountLayout counts={counts} setCounts={setCounts} till={catalog.settings?.till}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {warn ? (
          <Alert tone="warning">
            مبلغ الافتتاح في {oddDrawers} أكبر بكثير من المعتاد. تأكد من الأرقام، فقد تكون زادت خانة بالخطأ.
          </Alert>
        ) : null}
        <Button size="lg" fullWidth icon={<CashIcon />} onClick={() => void open(warn)} loading={saving}>
          {warn ? 'نعم، المبلغ صحيح، افتح الوردية' : 'افتح الوردية'}
        </Button>
      </CountLayout>
    </div>
  );
}

const METHOD_NAMES = {
  cash: 'نقد',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل',
  cheque: 'شيك',
  voucher: 'قسيمة',
  points: 'نقاط',
} as const;

type MethodRow = ShiftActivity['byMethod'][number];

/**
 * «إغلاق الوردية» (kit cashier/ShiftClose): a blind count of each drawer, then the summary by
 * payment method. The expected amount and the difference show only to a role that may see them
 * (shift.view_difference, 11/16); the device saves shift_close with every term of the formula.
 */
export function ShiftCloseScreen({
  session,
  catalog,
  shift,
  onBack,
  onClosed,
  onSaved,
  openCart = null,
  onHoldCart,
}: {
  session: StaffSession;
  catalog: Catalog;
  shift: OpenShift;
  onBack: () => void;
  /** An invoice still open in the cart: the close warns about it (its total when known) */
  openCart?: { lines: number; totalMinor: number | null; currency: CurrencyCode } | null;
  /** Puts that invoice aside (held) so it does not wait unpaid after the close */
  onHoldCart?: () => void;
  onClosed: () => void;
  /** The close is saved: the Z report is showing, the shift is no longer open (the header says so) */
  onSaved?: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const businessDate = useBusinessDate(catalog);
  const [step, setStep] = useState<'count' | 'summary' | 'done'>('count');
  // Each step opens at its top: after closing on a phone the «أُغلقت الوردية» banner must not sit cut above the screen
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.scrollIntoView?.({ block: 'start' });
  }, [step]);
  const [confirming, setConfirming] = useState(false);
  const [closedAt, setClosedAt] = useState(0);
  const { paper, print } = usePrint();
  // The same as opening: one (blind) amount per drawer, note by note one tap away («عدّ تفصيلي»)
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(totalCount));
  const [activity, setActivity] = useState<ShiftActivity | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSeeDifference = session.permissions.has('shift.view_difference');
  const canClose =
    session.permissions.has('shift.close_any') ||
    (session.permissions.has('shift.close_own') && shift.openedBy === session.userId);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((entries) => alive && setActivity(shiftActivity(shift.id, entries)));
    return () => {
      alive = false;
    };
  }, [pos.store, shift.id]);

  const cash = useMemo(
    () =>
      activity
        ? counts.map((count) =>
            closeDrawer(
              count.currency,
              settings.baseCurrency,
              catalog.rates,
              shift.opening.find((o) => o.currency === count.currency)?.amountMinor ?? 0,
              activity.terms.get(count.currency),
              count,
            ),
          )
        : [],
    [activity, counts, settings.baseCurrency, catalog.rates, shift.opening],
  );

  // Drawers counted as nothing although they should hold cash: asked about once before the summary
  const [askedEmpty, setAskedEmpty] = useState(false);
  const emptied = cash.filter((c) => c.countedMinor === 0 && c.expectedMinor > 0);
  useEffect(() => {
    if (emptied.length === 0) setAskedEmpty(false);
  }, [emptied.length]);

  // A foreign drawer counted far above what it should hold (the lira figure typed in the dollar box):
  // asked about once, with the typed amount, before the summary. The expected figure stays hidden.
  const odd = cash.filter(
    (c) =>
      c.currency !== settings.baseCurrency &&
      c.countedMinor > 0 &&
      (c.countedMinor > ODD_FOREIGN_MINOR || (c.expectedMinor > 0 && c.countedMinor > c.expectedMinor * 10)),
  );
  const oddSignature = odd.map((c) => `${c.currency}:${c.countedMinor}`).join();
  const [askedOdd, setAskedOdd] = useState('');

  async function close() {
    if (!activity) return;
    setSaving(true);
    setError(null);
    try {
      const payload = shiftClosePayload({
        shift,
        closedBy: session.userId,
        baseCurrency: settings.baseCurrency,
        cash,
        activity,
      });
      await pos.save({
        type: 'shift_close',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      await pos.local.remove(shift.key);
      await pos.local.set(LAST_CLOSED_KEY, shift.id);
      // The Z report follows: printed from here, then the cashier leaves
      setClosedAt(pos.now());
      setConfirming(false);
      setSaving(false);
      setStep('done');
      onSaved?.();
    } catch {
      setSaving(false);
      setError('لم تُغلق الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  const sellerNames = new Map(catalog.staff.users.map((u) => [u.id, u.fullName]));
  const zProps = (a: ShiftActivity) => ({
    shift,
    closedAt,
    closedByName: session.fullName,
    activity: a,
    cash,
    baseCurrency: settings.baseCurrency,
    storeName: settings.storeName || pos.device.storeName,
    showDifference: canSeeDifference,
    sellerNames,
  });

  // Display only: «الصافي» is what stayed in the drawer from payments, the cash paid back for returns taken off
  const methodRows = netMethodRows(activity).filter((row) => row.count > 0 || row.amountMinor !== 0);
  // What the returns paid back, per currency, for the line under the table
  const returnedByCurrency = new Map<string, number>();
  for (const refund of activity?.returns.byMethod ?? [])
    returnedByCurrency.set(
      refund.currency,
      (returnedByCurrency.get(refund.currency) ?? 0) + refund.amountMinor,
    );

  const columns: DataColumn<MethodRow>[] = [
    {
      key: 'method',
      header: 'طريقة الدفع',
      cell: (row) =>
        `${METHOD_NAMES[row.method]}${
          row.method === 'cash' && row.currency !== settings.baseCurrency ? ' بالدولار' : ''
        }`,
    },
    // A row that only paid cash back (no payment taken) has no count: a dash, never «0 دفعات» beside an amount
    { key: 'count', header: 'دفعات', numeric: true, cell: (row) => (row.count > 0 ? row.count : '—') },
    {
      key: 'amount',
      header: 'الصافي بعد المرتجعات',
      numeric: true,
      cell: (row) => <ExactMoney minor={row.amountMinor} currency={row.currency} className="font-semibold" />,
    },
  ];

  return (
    <div ref={topRef} className="mx-auto flex w-full max-w-6xl scroll-mt-4 flex-col gap-6">
      <FlowHeader
        // Once closed the only way out is «تمّ» beside the slip: one exit, never two
        onBack={step === 'count' ? onBack : step === 'done' ? undefined : () => setStep('count')}
        backLabel={step === 'count' ? 'ارجع للبيع' : 'ارجع للعدّ'}
        icon={step === 'count' ? <LockIcon size={24} /> : <ReportsIcon size={24} />}
        title={step === 'count' ? 'إغلاق الوردية' : step === 'done' ? 'أُغلقت الوردية' : 'ملخّص الوردية'}
        description={
          // Whole parts that wrap together: never a separator dot left at the end of a line.
          // The summary step says the invoice count once, in its chip
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {/* The step stays beside the title, where the eye is, not at the far end of a wide screen */}
            {step === 'done' ? null : (
              <span className="font-semibold whitespace-nowrap text-ink">
                {step === 'count' ? 'الخطوة 1 من 2: العدّ' : 'الخطوة 2 من 2: المراجعة'}
              </span>
            )}
            <span className="whitespace-nowrap">{shift.openedByName}</span>
            <span className="whitespace-nowrap">
              {step === 'done' && closedAt
                ? `من ${clockText(shift.openedAt, digits)} إلى ${clockText(closedAt, digits)}`
                : `منذ ${clockText(shift.openedAt, digits)}`}
            </span>
            <bdi dir="ltr" className="num whitespace-nowrap">
              {shift.number}
            </bdi>
            {activity && step !== 'summary' ? (
              <span className="whitespace-nowrap">{counted(activity.saleCount, INVOICES, digits)}</span>
            ) : null}
          </span>
        }
      />
      {step === 'count' ? (
        <CountLayout
          counts={counts}
          setCounts={setCounts}
          till={settings.till}
          intro={
            <Alert tone="info">
              عدّ أعمى: لا يظهر المبلغ المتوقع. عُدّ ما في يدك فقط.
              <span className="block">عُدّ كل النقد الذي في الدرج.</span>
            </Alert>
          }
        >
          {emptied.length > 0 && askedEmpty ? (
            <Alert tone="warning">
              لم تعدّ شيئاً في {emptied.map((c) => drawerName(c.currency)).join(' و')}. هل هذا صحيح؟ إن كان
              الدرج فارغاً تابع، وإلا اكتب ما في يدك.
            </Alert>
          ) : null}
          {odd.length > 0 && askedOdd === oddSignature ? (
            <Alert tone="warning">
              {odd.map((c) => (
                <span key={c.currency} className="block">
                  في {drawerName(c.currency)} كتبتَ <Money minor={c.countedMinor} currency={c.currency} />.{' '}
                  {c.currency === 'USD' ? 'هل هذا المبلغ بالدولار؟' : 'هل هذا المبلغ صحيح؟'}
                </span>
              ))}
              إن كان خطأً فصحّحه، وإلا تابع.
            </Alert>
          ) : null}
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              // A drawer that should hold cash and was counted as nothing is asked about once (the amount stays hidden)
              if (emptied.length > 0 && !askedEmpty) setAskedEmpty(true);
              else if (odd.length > 0 && askedOdd !== oddSignature) setAskedOdd(oddSignature);
              else setStep('summary');
            }}
            disabled={!activity}
          >
            {emptied.length > 0 && askedEmpty
              ? 'نعم، الدرج فارغ، تابع'
              : odd.length > 0 && askedOdd === oddSignature
                ? 'نعم، المبلغ صحيح، تابع'
                : 'راجع وأغلق'}
          </Button>
        </CountLayout>
      ) : step === 'done' && activity ? (
        <section aria-label="تقرير الإغلاق" className="mx-auto flex w-full max-w-sm flex-col gap-4">
          <Alert tone="success">أُغلقت الوردية وحُفظ إغلاقها. اطبع التقرير ثم اضغط «تمّ».</Alert>
          <div className="mx-auto rounded-card border border-line bg-surface p-3 shadow-e1">
            <ZReport {...zProps(activity)} />
          </div>
          {/* The actions stay in view on a phone: «اطبع» first, then «تمّ» (the one way out); the page ends below them */}
          <div className="flex flex-col gap-3 max-lg:sticky max-lg:-bottom-6 max-lg:z-10 max-lg:-mx-2 max-lg:border-t max-lg:border-line max-lg:bg-canvas max-lg:p-3">
            <Button size="lg" fullWidth icon={<PrintIcon />} onClick={() => print('80mm')}>
              اطبع
            </Button>
            <Button size="lg" fullWidth variant="secondary" onClick={onClosed}>
              تمّ
            </Button>
          </div>
          {paper ? (
            <PrintSheet paper={paper}>
              <ZReport {...zProps(activity)} />
            </PrintSheet>
          ) : null}
        </section>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <section aria-label="الملخّص حسب طريقة الدفع" className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <IconChip>
                <SalesIcon />
              </IconChip>
              <h2 className="flex-1 text-lg font-semibold text-ink">حسب طريقة الدفع</h2>
              {activity ? <Badge>{counted(activity.saleCount, INVOICES, digits)}</Badge> : null}
            </div>
            <DataTable
              caption="الملخّص حسب طريقة الدفع"
              columns={columns}
              rows={methodRows}
              rowKey={(row) => `${row.method}:${row.currency}`}
              loading={!activity}
              empty={
                <EmptyState icon={SalesIcon} title="لا مبيعات في هذه الوردية." className="border-0 py-8" />
              }
            />
            {activity &&
            (activity.returns.count > 0 ||
              activity.vouchers.count > 0 ||
              (activity.deposits?.count ?? 0) > 0 ||
              (activity.rentalDeposits?.count ?? 0) > 0 ||
              (activity.depositsUsed?.length ?? 0) > 0 ||
              activity.saleCount > 0 ||
              activity.movements.length > 0 ||
              (activity.cashIn?.receipts.length ?? 0) > 0) ? (
              <ul aria-label="مرتجعات وقسائم" className="flex flex-col gap-1 text-sm text-ink-muted">
                {/* The same figures the closing slip opens with, so the two agree */}
                {activity.salesTotals
                  .filter((t) => t.totalMinor !== 0)
                  .map((t) => {
                    const back = activity ? returnedGoodsIn(activity, t.currency) : 0;
                    return (
                      <Fragment key={t.currency}>
                        <li className="flex flex-wrap items-center gap-x-1">
                          {activity.returns.count > 0 ? 'إجمالي المبيعات قبل المرتجعات' : 'إجمالي المبيعات'}:{' '}
                          <ExactMoney minor={t.totalMinor} currency={t.currency} className="text-ink" />
                          {t.discountMinor > 0 ? (
                            <>
                              {' · '}منها حسم <ExactMoney minor={t.discountMinor} currency={t.currency} />
                            </>
                          ) : null}
                        </li>
                        {activity.returns.count > 0 && back > 0 ? (
                          <li className="flex flex-wrap items-center gap-x-1">
                            صافي المبيعات بعد المرتجعات:{' '}
                            <ExactMoney
                              minor={t.totalMinor - back}
                              currency={t.currency}
                              className="text-ink"
                            />
                          </li>
                        ) : null}
                      </Fragment>
                    );
                  })}
                {(activity.cashRounding ?? []).map((r) => (
                  <li key={`rd:${r.currency}`} className="flex flex-wrap items-center gap-x-1">
                    {activity.returns.count > 0 ? 'منها تقريب النقد (بيع ومرتجع)' : 'منها تقريب النقد'}:{' '}
                    <Money
                      minor={r.amountMinor}
                      currency={r.currency}
                      decimals={2}
                      trimZeros
                      className="text-ink"
                    />
                  </li>
                ))}
                {activity.bySeller.length > 0 ? (
                  <li className="flex flex-col gap-0.5">
                    <span className="font-semibold text-ink">البائعون</span>
                    {activity.bySeller.map((r) => (
                      <span
                        key={`${r.sellerId}:${r.currency}`}
                        className="flex flex-wrap items-center gap-x-1"
                      >
                        <bdi>{sellerNames.get(r.sellerId) ?? 'بائع'}</bdi> ·{' '}
                        {/* One seller: the chip above already counts the invoices */}
                        {new Set(activity.bySeller.map((s) => s.sellerId)).size > 1 ? (
                          <>{counted(r.count, INVOICES, digits)} · </>
                        ) : null}
                        <ExactMoney minor={r.totalMinor} currency={r.currency} className="text-ink" />
                      </span>
                    ))}
                  </li>
                ) : null}
                {activity.returns.count > 0 ? (
                  <li>
                    المرتجعات:{' '}
                    {counted(activity.returns.count, ['مرتجع واحد', 'مرتجعان', 'مرتجعات', 'مرتجعاً'], digits)}
                    {[...returnedByCurrency].map(([currency, amountMinor]) => (
                      <span key={currency}>
                        {' · '}
                        <ExactMoney minor={amountMinor} currency={currency as CurrencyCode} />
                      </span>
                    ))}
                  </li>
                ) : null}
                {/* What came into the drawer besides sales, as on the final slip, so the cash row is no surprise */}
                {(activity.cashIn?.receipts ?? []).map((r) => (
                  <li key={`rc:${r.currency}`} className="flex flex-wrap items-center gap-x-1">
                    دفعات زبائن نقداً:{' '}
                    <ExactMoney minor={r.amountMinor} currency={r.currency} className="text-ink" />
                  </li>
                ))}
                {(activity.instalments?.sales ?? []).map((r) => (
                  <li key={`is:${r.currency}`} className="flex flex-wrap items-center gap-x-1">
                    مبيعات بالتقسيط: {counted(r.count, INVOICES, digits)} · دفعات أولى{' '}
                    <ExactMoney minor={r.downMinor} currency={r.currency} className="text-ink" /> · مقسَّط{' '}
                    <ExactMoney minor={r.financedMinor} currency={r.currency} className="text-ink" />
                  </li>
                ))}
                {(activity.instalments?.collected ?? []).map((r) => (
                  <li key={`ic:${r.currency}`} className="flex flex-wrap items-center gap-x-1">
                    أقساط مقبوضة:{' '}
                    <ExactMoney minor={r.amountMinor} currency={r.currency} className="text-ink" />
                  </li>
                ))}
                {activity.movements.map((m, i) => (
                  <li key={`mv:${i}`} className="flex flex-wrap items-center gap-x-1">
                    {MOVEMENT_NAMES[m.kind]} · <bdi>{m.reason}</bdi>:{' '}
                    <ExactMoney minor={m.amountMinor} currency={m.currency} className="text-ink" />
                  </li>
                ))}
                {refundVouchers(activity).map((v) => (
                  <li key={v.currency} className="flex flex-wrap items-center gap-x-1">
                    قسائم مرتجع صادرة:{' '}
                    <ExactMoney minor={v.amountMinor} currency={v.currency} className="text-ink" />
                  </li>
                ))}
                {activity.vouchers.count > 0 ? (
                  <li className="flex flex-wrap items-center gap-x-1">
                    قسائم الهدية المباعة:{' '}
                    {counted(activity.vouchers.count, ['قسيمة واحدة', 'قسيمتان', 'قسائم', 'قسيمة'], digits)} ·{' '}
                    {activity.vouchers.byCurrency.map((v) => (
                      <ExactMoney key={v.currency} minor={v.amountMinor} currency={v.currency} />
                    ))}
                  </li>
                ) : null}
                {(activity.rentalDeposits?.byCurrency ?? []).map((v) => (
                  <li key={`rt:${v.currency}`} className="flex flex-wrap items-center gap-x-1">
                    تأمين إيجار مقبوض:{' '}
                    <ExactMoney minor={v.amountMinor} currency={v.currency} className="text-ink" />
                  </li>
                ))}
                {(activity.deposits?.byCurrency ?? []).map((v) => (
                  <li key={`di:${v.currency}`} className="flex flex-wrap items-center gap-x-1">
                    عربون مقبوض:{' '}
                    <ExactMoney minor={v.amountMinor} currency={v.currency} className="text-ink" />
                  </li>
                ))}
                {(activity.depositsUsed ?? []).map((v) => (
                  <li key={`do:${v.currency}`} className="flex flex-wrap items-center gap-x-1">
                    عربون مستعمل:{' '}
                    <ExactMoney minor={v.amountMinor} currency={v.currency} className="text-ink" />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2">
            <h2 className="text-sm font-semibold text-ink-muted">النقد المعدود</h2>
            {cash.map((c) => (
              <div
                key={c.currency}
                className="flex flex-col gap-1.5 rounded-control bg-surface-total px-4 py-3"
              >
                <Money
                  minor={c.countedMinor}
                  currency={c.currency}
                  className="text-kpi font-bold tracking-tight text-ink"
                  unitClassName="text-base font-semibold text-ink-subtle"
                />
                {canSeeDifference ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted">
                    المتوقع <Money minor={c.expectedMinor} currency={c.currency} className="text-ink" /> ·
                    الفرق{' '}
                    <Badge tone={c.differenceMinor < 0 ? 'danger' : 'success'}>
                      <Money minor={c.differenceMinor} currency={c.currency} />
                    </Badge>
                  </p>
                ) : null}
              </div>
            ))}
            {!canSeeDifference ? (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <EyeOffIcon size={16} className="shrink-0 text-ink-subtle" />
                المتوقع والفرق يراهما المدير فقط.
              </p>
            ) : null}
            {!canClose ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-card border border-warning/20 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-ink"
              >
                <WarningIcon size={20} className="shrink-0" />
                دورك لا يسمح بإغلاق هذه الوردية. اطلب من المدير إغلاقها.
              </p>
            ) : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            {confirming ? (
              // A box over the page, centred and dimmed: the page behind does not move and its head stays
              createPortal(
                <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-ink/45 p-4">
                  <div
                    role="alertdialog"
                    aria-label="تأكيد إغلاق الوردية"
                    className="my-auto flex w-full max-w-md flex-col gap-3 rounded-card border border-warning/20 bg-warning-soft p-4 shadow-e3"
                  >
                    <p className="font-semibold text-warning-ink">
                      تغلق الوردية الآن؟ بعد الإغلاق لا يُعدَّل العدّ ولا تُضاف مبيعات إلى هذه الوردية.
                    </p>
                    {openCart ? (
                      <div role="alert" className="flex flex-col gap-2 rounded-control bg-surface p-3">
                        <p className="flex items-start gap-2 text-sm font-semibold text-warning-ink">
                          <WarningIcon size={20} className="shrink-0" />
                          <span>
                            في السلة فاتورة مفتوحة لم تُدفع
                            {openCart.totalMinor !== null ? (
                              <>
                                {' '}
                                بقيمة <Money minor={openCart.totalMinor} currency={openCart.currency} />
                              </>
                            ) : null}
                            . علّقها لتبقى محفوظة، أو ارجع وأتمّ بيعها.
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {onHoldCart ? (
                            <Button variant="secondary" onClick={onHoldCart} disabled={saving}>
                              علّق الفاتورة
                            </Button>
                          ) : null}
                          <Button variant="secondary" onClick={onBack} disabled={saving}>
                            ارجع للبيع
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <Button size="lg" fullWidth icon={<LockIcon />} onClick={close} loading={saving}>
                      نعم، أغلق الوردية
                    </Button>
                    <Button variant="ghost" fullWidth onClick={() => setConfirming(false)} disabled={saving}>
                      لا، ارجع
                    </Button>
                  </div>
                </div>,
                document.body,
              )
            ) : (
              <Button
                size="lg"
                fullWidth
                icon={<LockIcon />}
                onClick={() => setConfirming(true)}
                disabled={!canClose}
              >
                أغلق الوردية
              </Button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

const KIND_TEXT: Record<
  Exclude<CashMovementKind, 'expense'>,
  { label: string; hint: string; icon: ReactNode }
> = {
  pay_in: { label: 'إيداع في الدرج', hint: 'نقد يدخل الدرج من الخزنة، كالفكّة', icon: <AddIcon /> },
  pay_out: { label: 'سحب من الدرج', hint: 'نقد يخرج من الدرج إلى الخزنة أو المكتب', icon: <RemoveIcon /> },
  safe_drop: { label: 'إيداع للخزنة', hint: 'الدرج ممتلئ؟ انقل جزءاً منه إلى الخزنة', icon: <LockIcon /> },
};

/**
 * «حركات الدرج» (kit cashier/CashMovements): pay-in, pay-out and a drop to the safe, each with its
 * reason and the manager's code (contract Q5), saved as cash_movement (CSH). Works offline.
 */
export function CashMovementScreen({
  session,
  catalog,
  staff,
  shift,
  onBack,
}: {
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shift: OpenShift;
  onBack: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const businessDate = useBusinessDate(catalog);
  const currencies = drawerCurrencies(catalog);
  const [kind, setKind] = useState<Exclude<CashMovementKind, 'expense'>>('pay_in');
  const [currency, setCurrency] = useState<CurrencyCode>(currencies[0]!);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OutboxEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then(
      (entries) =>
        alive &&
        setSaved(
          entries
            .filter(
              (e) =>
                e.type === 'cash_movement' && (e.doc.payload as { shiftId?: string }).shiftId === shift.id,
            )
            .reverse(),
        ),
    );
    return () => {
      alive = false;
    };
  }, [pos.store, shift.id, tick]);

  const minor = parseAmount(amount, currency);
  const ready = minor !== null && minor > 0 && reason.trim().length > 0;

  async function record(approval: Parameters<typeof cashMovementPayload>[0]['approval']) {
    setApproving(false);
    setError(null);
    try {
      const payload = cashMovementPayload({
        shiftId: shift.id,
        kind,
        currency,
        amountMinor: minor!,
        baseCurrency: settings.baseCurrency,
        rates: catalog.rates,
        reason,
        reference: reference || null,
        performedBy: session.userId,
        approval,
      });
      await pos.save({
        type: 'cash_movement',
        payload: payload as unknown as Record<string, unknown>,
        businessDate: businessDate(),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      setAmount('');
      setReason('');
      setReference('');
      setTick((t) => t + 1);
    } catch {
      setError('لم تُسجَّل الحركة. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<TransferIcon size={24} />}
        title="حركات الدرج"
        description="كل حركة باسمك وبسبب مكتوب، وبرمز المدير. تُحفظ على الجهاز وتُرسل وحدها."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section
          aria-label="حركة جديدة"
          className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
        >
          <ChoiceGroup label="نوع الحركة" className="grid gap-3 xl:grid-cols-3">
            {(Object.keys(KIND_TEXT) as (keyof typeof KIND_TEXT)[]).map((k) => (
              <OptionTile
                key={k}
                selected={kind === k}
                onClick={() => setKind(k)}
                icon={KIND_TEXT[k].icon}
                title={KIND_TEXT[k].label}
                description={KIND_TEXT[k].hint}
                className="xl:min-h-24"
              />
            ))}
          </ChoiceGroup>
          {currencies.length > 1 ? (
            <ChoiceGroup label="الدرج" className="grid grid-cols-2 gap-3">
              {currencies.map((c) => (
                <OptionTile
                  key={c}
                  selected={currency === c}
                  onClick={() => {
                    setCurrency(c);
                    setAmount('');
                  }}
                  icon={<CashIcon />}
                  title={c === 'SYP' ? 'درج الليرة' : c === 'USD' ? 'درج الدولار' : c}
                />
              ))}
            </ChoiceGroup>
          ) : null}
          <TextField
            label="المبلغ"
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) =>
              setAmount(
                e.target.value
                  .replace(/[^\d.٠-٩٫]/g, '')
                  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
                  .replace('٫', '.'),
              )
            }
            inputClassName="num text-2xl font-bold"
            endAdornment={<span className="me-4 shrink-0 text-base">{CURRENCIES[currency].symbolAr}</span>}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="السبب"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
            />
            <TextField
              label="رقم الوصل (اختياري)"
              value={reference}
              onChange={(e) => setReference(e.target.value.slice(0, 64))}
              dir="ltr"
            />
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {approving ? (
            <ManagerCode
              staff={staff}
              permission="cash.move"
              reason="الحركة تُخرج أو تُدخل نقداً في الدرج، فتحتاج رمز مدير حاضر. تُسجَّل باسمه."
              onApproved={(approval) => void record(approval)}
              onCancel={() => setApproving(false)}
            />
          ) : (
            <Button size="lg" fullWidth onClick={() => setApproving(true)} disabled={!ready}>
              سجّل الحركة{minor ? ' · ' : ''}
              {minor ? <Money minor={minor} currency={currency} /> : null}
            </Button>
          )}
        </section>
        <section
          aria-label="حركات هذه الوردية"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-e1 lg:sticky lg:top-0"
        >
          <div className="flex items-center gap-3">
            <h2 className="flex-1 text-lg font-semibold text-ink">حركات هذه الوردية</h2>
            {saved.length > 0 ? (
              <Badge>
                <span className="num">{saved.length}</span>
              </Badge>
            ) : null}
          </div>
          {saved.length === 0 ? (
            <EmptyState icon={TransferIcon} title="لا حركات بعد." className="py-8" />
          ) : null}
          <ul className="flex flex-col divide-y divide-line">
            {saved.map((entry) => {
              const p = entry.doc.payload as unknown as CashMovementPayload;
              const text = KIND_TEXT[p.kind as keyof typeof KIND_TEXT];
              return (
                <li key={entry.id} className="flex items-center gap-3 py-3">
                  <IconChip size="sm">{text?.icon ?? <CashIcon />}</IconChip>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-ink">{text?.label ?? p.kind}</span>
                    <span className="truncate text-xs text-ink-muted">
                      {clockText(Date.parse(entry.doc.deviceTime), digits)} · {p.reason}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Money minor={p.amountMinor} currency={p.currency} className="font-semibold text-ink" />
                    <StatusChip status={entry.status === 'confirmed' ? 'sent' : 'pendingSend'} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
