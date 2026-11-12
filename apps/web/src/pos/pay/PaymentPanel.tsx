import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES } from '@serva/core/currencies';
import { convert } from '@serva/core/money';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import {
  buildSalePayload,
  businessDateOf,
  rateFor,
  settleSale,
  type SaleSettlement,
  type SaleTender,
} from '@serva/core/sale';
import type { PaymentMethod } from '@serva/core/contracts/documents';
import type { OutboxEntry } from '@serva/sync';
import {
  AddIcon,
  AlertCircleIcon,
  Avatar,
  BackIcon,
  BookIcon,
  Button,
  CardIcon,
  CashIcon,
  CheckIcon,
  ChequeIcon,
  cn,
  DeleteIcon,
  displayNumber,
  GiftIcon,
  IconButton,
  Keypad,
  Money,
  PhoneIcon,
  SparklesIcon,
  TextField,
  TransferIcon,
  UserIcon,
  useDigits,
  type Icon,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { CustomerHistory } from '../customers/CustomerHistory';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import { Kbd } from '../sale/Kbd';
import { nextOrderNo } from '../sale/orders';
import { digitOf } from '../PinScreen';
import { usePos } from '../services';
import { deviceDocuments } from '../shift/shift';
import { pricingInput, type Cart, type PricingContext } from '../sale/cart';
import {
  amountText,
  dueIn,
  parseAmount,
  payOptions,
  quickAmounts,
  REFERENCE_LABEL,
  tenderOf,
  type PayOption,
} from './payment';
import { findVoucher, tillVouchers } from './vouchers';

export interface PaymentPanelProps {
  cart: Cart;
  ctx: PricingContext;
  totalMinor: number;
  catalog: Catalog;
  shiftId: string;
  cashierId: string;
  /** «البيع بالآجل» (sale.credit): the credit method shows once a customer is picked */
  canCredit?: boolean;
  /** «البائع» when it is not the cashier (03 › عمولة البائع) */
  salespersonId?: string | null;
  /** A customer the owner marked «زبون جملة» was picked: the cart moves to the wholesale price */
  onWholesaleCustomer?: () => void;
  onBack: () => void;
  onCompleted: (entry: OutboxEntry) => void;
}

const VOUCHER_OPTION = (base: PayOption['currency']): PayOption => ({
  key: 'voucher',
  method: 'voucher',
  currency: base,
  label: 'قسيمة',
  rate: null,
});

interface Part {
  option: PayOption;
  tender: SaleTender;
}

/** Each method's picture on its card and in the parts paid (هوية 4 › ChoiceCard). */
const METHOD_ICON: Record<PaymentMethod, Icon> = {
  cash: CashIcon,
  card: CardIcon,
  wallet: PhoneIcon,
  transfer: TransferIcon,
  credit: BookIcon,
  cheque: ChequeIcon,
  voucher: GiftIcon,
  points: SparklesIcon,
};

/**
 * The payment panel (kit cashier/Payment), beside the cart: what is due in both currencies, the
 * method, the amount received with quick notes and the keypad, the change live, and a split over
 * several methods. «أتمّ الدفع» (or Enter) builds the sale with buildSalePayload(), saves it in the
 * outbox, where it takes its INV number, and hands it to the receipt.
 */
export function PaymentPanel({
  cart,
  ctx,
  totalMinor,
  catalog,
  shiftId,
  cashierId,
  canCredit = false,
  onWholesaleCustomer,
  salespersonId = null,
  onBack,
  onCompleted,
}: PaymentPanelProps) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const base = ctx.currency;
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [history, setHistory] = useState(false);
  const [picking, setPicking] = useState(false);
  // This till's own documents, for the vouchers it issued or spent that the server has not sent back
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [pos.store]);
  const vouchers = useMemo(() => tillVouchers(catalog.vouchers, entries ?? []), [catalog.vouchers, entries]);
  const hasVouchers = Boolean(cart.voucher) || [...vouchers.values()].some((v) => v.balanceMinor > 0);
  // «نقاط الولاء» (03 › الألبسة): what the picked customer's points are worth, as last pulled
  const loyalty = settings.loyalty ?? null;
  const points = customer ? (catalog.customers.find((c) => c.id === customer.id)?.loyaltyPoints ?? 0) : 0;
  const pointsWorth = loyalty ? points * loyalty.pointValueMinor : 0;
  const options = useMemo(() => {
    const list = payOptions(base, settings.enabledCurrencies, catalog.rates, catalog.collectRates);
    if (hasVouchers) list.push(VOUCHER_OPTION(base));
    if (customer && loyalty && points > 0) {
      list.push({ key: 'points', method: 'points', currency: base, label: `نقاط (${points})`, rate: null });
    }
    if (customer && canCredit) {
      list.push({ key: 'credit', method: 'credit', currency: base, label: 'آجل على الحساب', rate: null });
      list.push({ key: 'cheque', method: 'cheque', currency: base, label: 'شيك', rate: null });
    }
    return list;
  }, [
    base,
    settings.enabledCurrencies,
    catalog.rates,
    catalog.collectRates,
    customer,
    canCredit,
    hasVouchers,
    loyalty,
    points,
  ]);
  // An exchange opens on the voucher of the return just saved
  const [option, setOption] = useState<PayOption>(cart.voucher ? VOUCHER_OPTION(base) : options[0]!);
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [text, setText] = useState('');
  const [reference, setReference] = useState(cart.voucher ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const referenceRef = useRef<HTMLInputElement>(null);

  const cashSteps = settings.cashRoundingSteps;
  const typed = parseAmount(text, option.currency);
  const settleWith = (tenders: SaleTender[]): SaleSettlement | { error: string } => {
    try {
      return settleSale({
        currency: base,
        exchangeRates: ctx.rates,
        totalMinor,
        payments: tenders,
        cashSteps,
      });
    } catch {
      return { error: 'المبلغ أكبر من المطلوب. البطاقة والمحفظة والتحويل تدفع المبلغ تماماً، دون باقٍ.' };
    }
  };
  const before = settleWith(parts.map((p) => p.tender));
  const remainingBase = 'error' in before ? totalMinor : before.remainingMinor;
  const nonCash = option.method !== 'cash';
  // Points pay up to what they are worth, less what this sale already took from them
  const pointsLeft =
    pointsWorth -
    parts.filter((p) => p.tender.method === 'points').reduce((sum, p) => sum + p.tender.amountMinor, 0);
  // A voucher pays what is left on it, less what this sale already took from it
  const voucher = option.method === 'voucher' ? findVoucher(vouchers, reference) : null;
  const voucherLeft = voucher
    ? voucher.balanceMinor -
      parts
        .filter((p) => p.tender.method === 'voucher' && p.tender.reference === voucher.code)
        .reduce((sum, p) => sum + p.tender.amountMinor, 0)
    : 0;
  // Non-cash pays exactly what is left unless the cashier types less (a split).
  const amount =
    typed ??
    (option.method === 'voucher'
      ? voucher
        ? Math.min(remainingBase, Math.max(0, voucherLeft))
        : null
      : option.method === 'points'
        ? Math.min(remainingBase, Math.max(0, pointsLeft))
        : nonCash
          ? remainingBase
          : null);
  const current = amount && amount > 0 ? tenderOf(option, amount, voucher ? voucher.code : reference) : null;
  const pointsProblem =
    option.method === 'points' && (amount ?? 0) > pointsLeft ? 'المبلغ أكبر مما تساويه نقاط الزبون.' : null;
  const voucherProblem =
    pointsProblem ??
    (option.method !== 'voucher' || reference.trim() === '' || entries === null
      ? null
      : !voucher
        ? 'لا قسيمة بهذا الرقم على هذا الجهاز. تأكد من الرقم، أو انتظر وصولها إن صدرت من جهاز آخر.'
        : voucherLeft <= 0
          ? 'صُرفت هذه القسيمة كلها.'
          : (amount ?? 0) > voucherLeft
            ? 'المبلغ أكبر مما بقي على القسيمة.'
            : null);
  const tenders = [...parts.map((p) => p.tender), ...(current ? [current] : [])];
  const settlement = settleWith(tenders);
  const needsReference =
    nonCash &&
    option.method !== 'credit' &&
    option.method !== 'points' &&
    current !== null &&
    current.reference === null;
  const onAccount = (method: string) => method === 'credit' || method === 'cheque' || method === 'points';
  const canComplete =
    !saving &&
    !('error' in settlement) &&
    settlement.covered &&
    !needsReference &&
    !voucherProblem &&
    tenders.length > 0;

  const dueHere = dueIn(option.currency, base, remainingBase, ctx.rates);
  const quick = option.method === 'cash' ? quickAmounts(dueHere, option.currency) : [];

  // An exchange: once this till's documents are read, the voucher goes in as the first part when
  // it does not cover the whole sale, and the cashier takes the rest by any method
  const exchanged = useRef(false);
  useEffect(() => {
    if (exchanged.current || !cart.voucher || entries === null) return;
    exchanged.current = true;
    const found = findVoucher(vouchers, cart.voucher);
    if (!found || found.balanceMinor <= 0 || found.balanceMinor >= totalMinor) return;
    const voucherOption = VOUCHER_OPTION(base);
    setSplit(true);
    setParts([{ option: voucherOption, tender: tenderOf(voucherOption, found.balanceMinor, found.code) }]);
    setOption(options[0]!);
    setReference('');
  }, [cart.voucher, entries, vouchers, totalMinor, base, options]);

  function pick(next: PayOption) {
    setOption(next);
    setText('');
    setReference('');
    setError(null);
    if (next.method !== 'cash') setTimeout(() => referenceRef.current?.focus(), 0);
  }

  function addPart() {
    if (!current || voucherProblem) return;
    setParts((list) => [...list, { option, tender: current }]);
    setText('');
    setReference('');
  }

  async function complete() {
    if (!canComplete) {
      if ('error' in settlement) setError(settlement.error);
      else if (voucherProblem) setError(voucherProblem);
      else if (needsReference) setError(`اكتب ${REFERENCE_LABEL[option.method]}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const now = pos.now();
      const businessDate = businessDateOf(now, settings.timezone, settings.businessDayCutoff);
      const service = settings.service
        ? {
            orderType:
              cart.service?.orderType ?? (settings.service.tables.length === 0 ? 'takeaway' : 'dine_in'),
            table: cart.service?.table ?? null,
            orderNo: settings.service.orderNumbers ? await nextOrderNo(pos.local, businessDate) : null,
          }
        : null;
      const payload = buildSalePayload({
        ...pricingInput(cart, ctx),
        shiftId,
        cashierId,
        payments: tenders,
        cashSteps,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        salespersonId,
        service,
        onlineOrderId: cart.onlineOrder?.id ?? null,
        prescription:
          cart.prescription && Object.values(cart.prescription).some(Boolean) ? cart.prescription : null,
      });
      const entry = await pos.save({
        type: 'sale',
        payload: payload as unknown as Record<string, unknown>,
        businessDate,
        engineVersion: PRICING_ENGINE_VERSION,
      });
      onCompleted(entry);
    } catch {
      setSaving(false);
      setError('لم تُحفظ الفاتورة. لم يُسجَّل شيء، حاول مرة أخرى.');
    }
  }

  const completeRef = useRef(complete);
  completeRef.current = complete;
  // While the customer picker is open, its own fields take the keys
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || pickingRef.current) return;
      if (event.key === 'Escape') {
        onBack();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void completeRef.current();
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      const digit = digitOf(event.key);
      if (digit) setText((t) => (t === '0' ? digit : (t + digit).slice(0, 12)));
      else if (event.key === 'Backspace') setText((t) => t.slice(0, -1));
      else if (event.key === '.' && CURRENCIES[option.currency].displayDecimals > 0)
        setText((t) => (t.includes('.') ? t : `${t || '0'}.`));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack, option.currency]);

  const foreign = catalog.rates[0]
    ? catalog.rates[0].unit === base
      ? catalog.rates[0].quote
      : catalog.rates[0].unit
    : null;
  const changeMinor = 'error' in settlement ? 0 : (settlement.change?.amountMinor ?? 0);
  const short = 'error' in settlement || !settlement.covered;
  const shortCash = 'error' in settlement ? 0 : settlement.remainingCashMinor;

  return (
    <section
      aria-label="الدفع"
      className="@container/pay flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e2 motion-safe:animate-sheet-in"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-2">
        <Button
          variant="secondary"
          size="md"
          icon={<BackIcon size={20} />}
          aria-keyshortcuts="Escape"
          onClick={onBack}
        >
          ارجع للسلة
        </Button>
        {/* Where the panel is narrow (a 1024 px screen), the methods and the keys say it is the payment */}
        <h2 className="sr-only text-lg font-semibold text-ink @3xl/pay:not-sr-only">
          {split ? 'الدفع · مقسّم' : 'الدفع'}
        </h2>
        <span className="flex-1" />
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-ink-muted">المطلوب</span>
          <Money
            minor={totalMinor}
            currency={base}
            className="text-kpi font-bold tracking-tight text-ink"
            unitClassName="text-base font-semibold text-ink-muted"
          />
          {foreign ? (
            <Money
              minor={convert(totalMinor, base, foreign, rateFor(ctx.rates, foreign, base))}
              currency={foreign}
              className="text-base font-semibold text-ink-muted"
            />
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 @3xl/pay:py-3">
        <div className="grid gap-4 @lg/pay:grid-cols-2 @3xl/pay:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @3xl/pay:gap-5">
          {/* How the customer pays, who the customer is, and the parts paid so far */}
          <div className="@container flex min-w-0 flex-col gap-3">
            <span className="text-sm font-semibold text-ink-muted">
              {split ? 'طريقة الجزء التالي' : 'طريقة الدفع'}
            </span>
            <div role="group" aria-label="طريقة الدفع" className="grid grid-cols-2 gap-2">
              {options.map((o) => {
                const on = option.key === o.key;
                const MethodIcon = METHOD_ICON[o.method];
                return (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(o)}
                    className={cn(
                      'flex min-h-16 flex-col items-start gap-1.5 rounded-card border p-2.5 text-start transition-[background-color,border-color,box-shadow] duration-120 ease-standard select-none @xs:flex-row @xs:items-center @xs:gap-3 @xs:p-3',
                      on
                        ? 'border-brand bg-brand-soft/40 ring-4 ring-brand/10'
                        : 'border-line bg-surface shadow-e1 hover:border-line-control',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-small transition-colors duration-120 ease-standard @xs:size-9',
                        on ? 'bg-brand text-on-brand' : 'bg-surface-muted text-ink-muted',
                      )}
                    >
                      <MethodIcon size={20} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold text-ink">{o.label}</span>
                      {o.rate ? (
                        <span className="text-xs font-semibold text-ink-muted">
                          سعر <bdi className="num">{displayNumber(o.rate.rate, digits)}</bdi>
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {picking ? (
              <CustomerPicker
                catalog={catalog}
                createdBy={cashierId}
                onPicked={(picked) => {
                  setCustomer(picked);
                  setPicking(false);
                  if (picked.priceTier === 'wholesale' && cart.priceTier !== 'wholesale') {
                    setParts([]);
                    onWholesaleCustomer?.();
                  }
                }}
                onCancel={() => setPicking(false)}
              />
            ) : customer ? (
              <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-e1">
                <div className="flex items-center gap-3">
                  <Avatar name={customer.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs text-ink-muted">الزبون</span>
                    <span className="truncate font-semibold text-ink">{customer.name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="md"
                    aria-pressed={history}
                    onClick={() => setHistory((h) => !h)}
                  >
                    مشترياته
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => {
                      setCustomer(null);
                      setParts((list) => list.filter((p) => !onAccount(p.option.method)));
                      if (onAccount(option.method)) pick(options[0]!);
                    }}
                  >
                    أزله
                  </Button>
                </div>
                {history ? <CustomerHistory customerId={customer.id} /> : null}
              </div>
            ) : (
              <Button
                variant="secondary"
                size="md"
                icon={<UserIcon size={20} />}
                onClick={() => setPicking(true)}
              >
                {canCredit ? 'اختر الزبون (للبيع بالآجل)' : 'اختر الزبون'}
              </Button>
            )}
            {/* One payment or several (هوية 4 › Segmented control), drawn as its track */}
            <div
              role="group"
              aria-label="طريقة التقسيم"
              className="grid grid-cols-2 gap-1 rounded-control bg-surface-muted p-1"
            >
              {[false, true].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  aria-pressed={split === on}
                  onClick={() => {
                    setSplit(on);
                    if (!on) setParts([]);
                  }}
                  className={cn(
                    'min-h-12 rounded-small px-3 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                    split === on
                      ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {on ? 'قسّم الدفع' : 'دفعة واحدة'}
                </button>
              ))}
            </div>
            {parts.length > 0 ? (
              <ul
                aria-label="الأجزاء المدفوعة"
                className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line"
              >
                {parts.map((part, index) => {
                  const PartIcon = METHOD_ICON[part.option.method];
                  return (
                    <li key={index} className="flex items-center gap-3 bg-surface py-1 ps-3 pe-1">
                      <PartIcon size={20} className="text-ink-subtle" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                        {part.option.label}
                      </span>
                      <Money
                        minor={part.tender.amountMinor}
                        currency={part.tender.currency}
                        className="font-bold text-ink"
                      />
                      <IconButton
                        label="احذف هذا الجزء"
                        size="md"
                        icon={<DeleteIcon size={20} />}
                        onClick={() => setParts((list) => list.filter((_, i) => i !== index))}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {/* What the customer hands over: the amount, the quick notes or the reference, the keys */}
          <div className="@container flex min-w-0 flex-col gap-2 @3xl/pay:gap-3">
            <div className="flex flex-col gap-0.5 rounded-control border border-brand bg-surface px-4 py-2 ring-4 ring-brand/15 @3xl/pay:py-2.5">
              {/* On a narrow panel the chosen method card says it; the words stay for screen readers */}
              <span className="sr-only text-xs font-semibold text-ink-muted @3xl/pay:not-sr-only">
                {option.method === 'cash' ? 'المبلغ المستلم' : 'المبلغ'} · {option.label}
              </span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="num truncate text-2xl font-bold text-ink @3xl/pay:text-3xl" dir="ltr">
                  {text
                    ? displayNumber(text, digits)
                    : amount
                      ? displayNumber(amountText(amount, option.currency), digits)
                      : displayNumber('0', digits)}
                </span>
                <span className="shrink-0 text-lg font-semibold text-ink-subtle">
                  {CURRENCIES[option.currency].symbolAr}
                </span>
              </span>
            </div>
            {option.method === 'credit' ? (
              <p className="flex items-start gap-2 rounded-card border border-warning/20 bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
                <BookIcon size={20} className="shrink-0" />
                <span>
                  يُسجَّل المبلغ ديناً على {customer?.name}
                  {customer?.creditLimitMinor !== null && customer?.creditLimitMinor !== undefined ? (
                    <>
                      {' '}
                      · حد الدين <Money minor={customer.creditLimitMinor} currency={base} />
                    </>
                  ) : null}
                  . يظهر في كشف حسابه.
                </span>
              </p>
            ) : option.method === 'points' ? (
              <p
                role="status"
                aria-label="نقاط الزبون"
                className="rounded-card border border-brand/20 bg-brand-soft px-3 py-2.5 text-sm text-brand-ink"
              >
                لدى {customer?.name} <bdi className="num font-bold">{points}</bdi> نقطة تساوي{' '}
                <Money minor={pointsWorth} currency={base} className="font-bold" />.
                {pointsProblem ? (
                  <span className="block font-semibold text-danger-ink">{pointsProblem}</span>
                ) : null}
              </p>
            ) : option.method !== 'cash' ? (
              <>
                <TextField
                  ref={referenceRef}
                  label={REFERENCE_LABEL[option.method] ?? 'المرجع'}
                  hint={option.method === 'voucher' ? 'امسح باركود القسيمة أو اكتب آخر أرقامها' : undefined}
                  value={reference}
                  onChange={(event) => setReference(event.target.value.slice(0, 64))}
                  dir="ltr"
                  inputMode={option.method === 'voucher' ? 'text' : 'numeric'}
                  autoComplete="off"
                />
                {option.method === 'voucher' && voucher ? (
                  <p role="status" aria-label="رصيد القسيمة" className="text-sm text-ink">
                    القسيمة{' '}
                    <bdi dir="ltr" className="num font-semibold">
                      {voucher.code}
                    </bdi>{' '}
                    · بقي عليها{' '}
                    <Money
                      minor={Math.max(0, voucherLeft)}
                      currency={voucher.currency}
                      className="font-bold"
                    />
                  </p>
                ) : null}
                {voucherProblem ? (
                  <p className="flex items-start gap-2 text-sm font-semibold text-danger-ink">
                    <AlertCircleIcon size={20} className="shrink-0" />
                    {voucherProblem}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2 @xs:grid-cols-3">
                {quick.map((value, index) => (
                  <Button
                    key={value}
                    variant="secondary"
                    size="md"
                    onClick={() => setText(amountText(value, option.currency))}
                  >
                    <span className="flex flex-col items-center">
                      {index === 0 ? <span className="text-xs text-ink-muted">المبلغ تماماً</span> : null}
                      <Money minor={value} currency={option.currency} symbol={false} className="text-lg" />
                    </span>
                  </Button>
                ))}
              </div>
            )}
            <Keypad
              onDigit={(d) => setText((t) => (t === '0' ? d : (t + d).slice(0, 12)))}
              onBackspace={() => setText((t) => t.slice(0, -1))}
              extraKey={CURRENCIES[option.currency].displayDecimals > 0 ? '.' : '00'}
              onExtraKey={() =>
                setText((t) =>
                  CURRENCIES[option.currency].displayDecimals > 0
                    ? t.includes('.')
                      ? t
                      : `${t || '0'}.`
                    : t
                      ? `${t}00`
                      : t,
                )
              }
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line bg-surface-total px-5 py-2 @3xl/pay:py-3">
        <div role="status" className="flex items-baseline gap-3">
          <span className="text-base font-semibold text-ink-muted">
            {short ? 'ناقص من الزبون' : 'الباقي'}
          </span>
          <span
            className={cn(
              'text-kpi font-bold tracking-tight @3xl/pay:text-total',
              short ? 'text-warning-ink' : 'text-ink',
            )}
          >
            <Money
              minor={short ? shortCash : changeMinor}
              currency={
                short
                  ? 'error' in settlement
                    ? base
                    : settlement.settlementCurrency
                  : (settlement.change?.currency ?? base)
              }
              unitClassName="text-xl font-semibold"
            />
          </span>
        </div>
        <span className="flex-1" />
        {error ? (
          <p role="alert" className="flex max-w-xs items-start gap-2 text-sm font-semibold text-danger-ink">
            <AlertCircleIcon size={20} className="shrink-0" />
            {error}
          </p>
        ) : null}
        {split && !canComplete && current ? (
          <Button size="lg" variant="secondary" icon={<AddIcon size={20} />} onClick={addPart}>
            أضف الجزء
          </Button>
        ) : null}
        <Button
          size="lg"
          icon={option.method === 'cash' ? <CashIcon size={20} /> : <CheckIcon size={20} />}
          aria-keyshortcuts="Enter"
          onClick={complete}
          disabled={!canComplete}
          loading={saving}
        >
          أتمّ الدفع
          <Kbd tone="brand">Enter</Kbd>
        </Button>
      </footer>
    </section>
  );
}
