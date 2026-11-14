import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import type { CashMovementKind, CashMovementPayload, ShiftMode } from '@serva/core/contracts/documents';
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
import type { Catalog } from '../catalog';
import { PrintSheet, usePrint } from '../../lib/print';
import { clockText, counted, INVOICES } from '../format';
import { ChoiceGroup, FlowHeader, OptionTile } from '../FlowParts';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { DrawerCounter, emptyCount, useCountKeypad } from './DrawerCounter';
import { ZReport } from './ZReport';
import {
  cashMovementPayload,
  closeDrawer,
  countTotal,
  deviceDocuments,
  LAST_CLOSED_KEY,
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
const OPENING_JUMP = 100;
/** Above this (in minor units) no opening count is believable, whatever the history */
const ABSURD_OPENING_MINOR = 1_000_000_000_000;

/** The drawers of the store: its base currency and each enabled one with a rate (10 › درج لكل عملة). */
export function drawerCurrencies(catalog: Catalog): CurrencyCode[] {
  const settings = catalog.settings!;
  const base = settings.baseCurrency;
  const foreign = settings.enabledCurrencies.filter(
    (c) => c !== base && catalog.rates.some((r) => r.unit === c || r.quote === c),
  );
  return [base, ...foreign];
}

const MODE_TEXT: Record<ShiftMode, string> = {
  per_cashier: 'درج لكل كاشير',
  shared: 'جهاز واحد وعدة أشخاص',
  handover: 'تسليم بعدّ',
};

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
  intro,
  children,
}: {
  counts: DrawerCount[];
  setCounts: (update: (list: DrawerCount[]) => DrawerCount[]) => void;
  /** What sits above the drawers, e.g. the blind-count note */
  intro?: ReactNode;
  /** The panel's end: errors and the button */
  children: ReactNode;
}) {
  const keypad = useCountKeypad(counts, setCounts);
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex flex-col gap-4">
        {intro}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {counts.map((count, i) => (
            <DrawerCounter
              key={count.currency}
              count={count}
              onChange={(next) => setCounts((list) => list.map((c, j) => (j === i ? next : c)))}
              active={keypad.activeIn(count.currency)}
              onActivate={(key) => keypad.activate(count.currency, key)}
            />
          ))}
        </div>
      </div>
      <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 lg:sticky lg:top-0">
        <div className="flex flex-col gap-1 rounded-control bg-surface-total px-4 py-3">
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
        <div className="flex flex-col gap-2">
          {keypad.targetText ? (
            <p className="truncate text-sm text-ink-muted">
              تكتب الأرقام في: <span className="font-semibold text-ink">{keypad.targetText}</span>
            </p>
          ) : null}
          <Keypad label="لوحة العدّ" {...keypad.keypad} />
        </div>
        {children}
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
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(emptyCount));
  const [saving, setSaving] = useState(false);
  const [warn, setWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(confirmed = false) {
    setError(null);
    // A count far above the usual opening is most likely a slipped key: ask once before it is saved
    if (!confirmed) {
      const usual = await pos.local.get<Record<string, number>>(LAST_OPENING_KEY);
      const odd = counts.some((c) => {
        const total = countTotal(c);
        const before = usual?.[c.currency] ?? 0;
        return total > ABSURD_OPENING_MINOR || (before > 0 && total > before * OPENING_JUMP);
      });
      if (odd) {
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
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <FlowHeader
        icon={<CashIcon size={24} />}
        title="افتح الوردية"
        description={`${MODE_TEXT[mode]} · عدّ النقد في الدرج قبل أول بيع. يُحفظ العدّ على الجهاز ويُرسل وحده.`}
      />
      <CountLayout counts={counts} setCounts={setCounts}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {warn ? (
          <Alert tone="warning">
            مبلغ الافتتاح أكبر بكثير من المعتاد. تأكد من الأرقام، فقد تكون زادت خانة بالخطأ.
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
}: {
  session: StaffSession;
  catalog: Catalog;
  shift: OpenShift;
  onBack: () => void;
  onClosed: () => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const businessDate = useBusinessDate(catalog);
  const [step, setStep] = useState<'count' | 'summary' | 'done'>('count');
  const [confirming, setConfirming] = useState(false);
  const [closedAt, setClosedAt] = useState(0);
  const { paper, print } = usePrint();
  const [counts, setCounts] = useState<DrawerCount[]>(() => drawerCurrencies(catalog).map(emptyCount));
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
    } catch {
      setSaving(false);
      setError('لم تُغلق الوردية. لم يُحفظ شيء، حاول مرة أخرى.');
    }
  }

  const zProps = (a: ShiftActivity) => ({
    shift,
    closedAt,
    closedByName: session.fullName,
    activity: a,
    cash,
    baseCurrency: settings.baseCurrency,
    storeName: settings.storeName || pos.device.storeName,
    showDifference: canSeeDifference,
  });

  const columns: DataColumn<MethodRow>[] = [
    {
      key: 'method',
      header: 'طريقة الدفع',
      cell: (row) =>
        `${METHOD_NAMES[row.method]}${
          row.method === 'cash' && row.currency !== settings.baseCurrency ? ' بالدولار' : ''
        }`,
    },
    { key: 'count', header: 'دفعات', numeric: true, cell: (row) => row.count },
    {
      key: 'amount',
      header: 'الصافي',
      numeric: true,
      cell: (row) => <Money minor={row.amountMinor} currency={row.currency} className="font-semibold" />,
    },
  ];

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <FlowHeader
        onBack={step === 'count' ? onBack : step === 'done' ? onClosed : () => setStep('count')}
        backLabel={step === 'count' ? 'ارجع للبيع' : step === 'done' ? 'اخرج' : 'ارجع للعدّ'}
        icon={step === 'count' ? <LockIcon size={24} /> : <ReportsIcon size={24} />}
        title={step === 'count' ? 'إغلاق الوردية' : step === 'done' ? 'أُغلقت الوردية' : 'ملخّص الوردية'}
        description={
          <>
            {shift.openedByName} · منذ {clockText(shift.openedAt, digits)} ·{' '}
            <bdi dir="ltr" className="num">
              {shift.number}
            </bdi>
            {activity ? ` · ${counted(activity.saleCount, INVOICES, digits)}` : ''}
          </>
        }
        actions={
          step === 'done' ? null : (
            <Badge tone="brand">{step === 'count' ? 'الخطوة 1 من 2: العدّ' : 'الخطوة 2 من 2: الملخّص'}</Badge>
          )
        }
      />
      {step === 'count' ? (
        <CountLayout
          counts={counts}
          setCounts={setCounts}
          intro={<Alert tone="info">عدّ أعمى: لا يظهر المبلغ المتوقع. عُدّ ما في يدك فقط.</Alert>}
        >
          <Button size="lg" fullWidth onClick={() => setStep('summary')} disabled={!activity}>
            تابع للملخّص
          </Button>
        </CountLayout>
      ) : step === 'done' && activity ? (
        <section aria-label="تقرير الإغلاق" className="flex flex-col items-start gap-4">
          <Alert tone="success">أُغلقت الوردية وحُفظ إغلاقها. اطبع تقرير الإغلاق ثم اخرج.</Alert>
          <div className="rounded-card border border-line bg-surface p-3 shadow-e1">
            <ZReport {...zProps(activity)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" icon={<ReportsIcon />} onClick={() => print('80mm')}>
              اطبع تقرير الإغلاق
            </Button>
            <Button size="lg" variant="secondary" onClick={onClosed}>
              تمّ، اخرج
            </Button>
          </div>
          {paper ? (
            <PrintSheet paper={paper}>
              <ZReport {...zProps(activity)} />
            </PrintSheet>
          ) : null}
        </section>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
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
              rows={activity?.byMethod ?? []}
              rowKey={(row) => `${row.method}:${row.currency}`}
              loading={!activity}
              empty={
                <EmptyState icon={SalesIcon} title="لا مبيعات في هذه الوردية." className="border-0 py-8" />
              }
            />
            {activity && (activity.returns.count > 0 || activity.vouchers.count > 0) ? (
              <ul aria-label="مرتجعات وقسائم" className="flex flex-col gap-1 text-sm text-ink-muted">
                {activity.returns.count > 0 ? (
                  <li>
                    المرتجعات:{' '}
                    {counted(activity.returns.count, ['مرتجع واحد', 'مرتجعان', 'مرتجعات', 'مرتجعاً'], digits)}
                  </li>
                ) : null}
                {activity.vouchers.count > 0 ? (
                  <li className="flex flex-wrap items-center gap-x-1">
                    قسائم الهدية المباعة وعربون التأجير:{' '}
                    {counted(activity.vouchers.count, ['قسيمة واحدة', 'قسيمتان', 'قسائم', 'قسيمة'], digits)} ·{' '}
                    {activity.vouchers.byCurrency.map((v) => (
                      <Money key={v.currency} minor={v.amountMinor} currency={v.currency} />
                    ))}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </section>
          <aside className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 lg:sticky lg:top-0">
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
              <div
                role="alertdialog"
                aria-label="تأكيد إغلاق الوردية"
                className="flex flex-col gap-3 rounded-card border border-warning/20 bg-warning-soft p-4"
              >
                <p className="font-semibold text-warning-ink">
                  تغلق الوردية الآن؟ بعد الإغلاق لا يُعدَّل العدّ ولا تُضاف مبيعات إلى هذه الوردية.
                </p>
                <Button size="lg" fullWidth icon={<LockIcon />} onClick={close} loading={saving}>
                  نعم، أغلق الوردية
                </Button>
                <Button variant="ghost" fullWidth onClick={() => setConfirming(false)} disabled={saving}>
                  لا، ارجع
                </Button>
              </div>
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
