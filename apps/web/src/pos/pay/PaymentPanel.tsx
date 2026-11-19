import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsPhone } from '../../lib/useIsPhone';
import { CURRENCIES } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import { PRICING_ENGINE_VERSION, roundCashDue } from '@serva/core/pricing';
import {
  buildSalePayload,
  businessDateOf,
  rateFor,
  settleSale,
  type SaleSettlement,
  type SaleTender,
} from '@serva/core/sale';
import type { Approval, PaymentMethod } from '@serva/core/contracts/documents';
import { chequeReference } from '@serva/core/contracts/cheques';
import { instalmentSettingsOf } from '@serva/core/installments';
import { cashOnly } from '@serva/core/distribution';
import type { OutboxEntry } from '@serva/sync';
import {
  AddIcon,
  Alert,
  AlertCircleIcon,
  Avatar,
  BackIcon,
  BookIcon,
  Button,
  CalendarIcon,
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
import { warrantyAsksCustomer } from '@serva/core/contracts/till';
import { CustomerHistory, fetchPurchases } from '../customers/CustomerHistory';
import { DateField } from '../../lib/DateField';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import { ExactMoney } from '../ExactMoney';
import { Kbd } from '../sale/Kbd';
import { nextOrderNo } from '../sale/orders';
import { digitOf } from '../PinScreen';
import { usePos } from '../services';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import { deviceDocuments } from '../shift/shift';
import { hasWarrantyDevice, pricingInput, type Cart, type PricingContext } from '../sale/cart';
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
import { InstalmentSheet } from './InstalmentSheet';
import { dayText } from '../../lib/dates';
import { feeLine, type PlanDraft } from './instalments';

const PLAN_KEY = 'pending-instalment-plan';
interface SavedPlan {
  customerId: string;
  draft: PlanDraft;
}

export interface PaymentPanelProps {
  cart: Cart;
  ctx: PricingContext;
  totalMinor: number;
  catalog: Catalog;
  shiftId: string;
  cashierId: string;
  /** «البيع بالآجل» (sale.credit): the credit method shows once a customer is picked */
  canCredit?: boolean;
  /** The branch's staff: a cashier without «البيع بالآجل» sells on account with a manager's code */
  staff?: readonly StaffMember[];
  /** «البائع» when it is not the cashier (03 › عمولة البائع) */
  salespersonId?: string | null;
  /** A customer the owner marked «زبون جملة» was picked: the cart moves to the wholesale price */
  onWholesaleCustomer?: () => void;
  /** The instalment fee of the plan chosen (0 with none): the cart panel shows the total with it */
  onPlanFee?: (minor: number) => void;
  /** A customer was picked: the till asks for their contract prices and prices the cart; true when some applied */
  onContractPrices?: (customerId: string) => Promise<boolean>;
  /** The customer was picked or removed: the cart keeps them, so a quotation, a reload or a held cart brings them back */
  onCustomer?: (customer: { id: string; name: string } | null) => void;
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

/** The part a plan puts on the customer's account */
const ACCOUNT_OPTION = (base: PayOption['currency']): PayOption => ({
  key: 'credit',
  method: 'credit',
  currency: base,
  label: 'آجل على الحساب',
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

/** The amount as the till shows it everywhere (5,772.5 shows 5,773): display only, the tender keeps its exact minor units */
function shownAmount(minor: number, currency: PayOption['currency']): number {
  const { decimals, displayDecimals } = CURRENCIES[currency];
  const unit = 10 ** (decimals - displayDecimals);
  return Math.round(minor / unit) * unit;
}

/**
 * The payment panel (kit cashier/Payment), beside the cart: what is due in both currencies, the
 * method, the amount received with quick notes and the keypad, the change live, and a split over
 * several methods. «أتمّ الدفع» (or Enter) builds the sale with buildSalePayload(), saves it in the
 * outbox, where it takes its INV number, and hands it to the receipt.
 */
export function PaymentPanel({
  cart,
  ctx,
  totalMinor: goodsTotalMinor,
  catalog,
  shiftId,
  cashierId,
  canCredit = false,
  staff,
  onWholesaleCustomer,
  onPlanFee,
  onContractPrices,
  onCustomer,
  salespersonId = null,
  onBack,
  onCompleted,
}: PaymentPanelProps) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const base = ctx.currency;
  // الأقساط: the plan chosen in the sheet. It adds one line, «رسم التقسيط», to the invoice, so the
  // total the panel works with is the goods plus that fee; nothing else about paying changes
  const installmentSettings = instalmentSettingsOf(settings.installments);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [planning, setPlanning] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlanDraft | null>(null);
  const [planId] = useState(() => crypto.randomUUID());
  const totalMinor = goodsTotalMinor + (plan?.markupMinor ?? 0);
  const feeMinor = plan?.markupMinor ?? 0;
  useEffect(() => {
    onPlanFee?.(feeMinor);
    // the callback is the screen's own setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeMinor]);
  useEffect(() => () => onPlanFee?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  const saleCart = useMemo(
    () => (plan ? { ...cart, lines: [...cart.lines, feeLine(cart, plan.markupMinor, base)] } : cart),
    [cart, plan, base],
  );
  // A customer already on the cart (a quotation's, a rental's, a reloaded sale) is the one paying
  const [customer, setCustomer] = useState<PickedCustomer | null>(() => {
    const on = cart.customer;
    if (!on) return null;
    const known = catalog.customers.find((c) => c.id === on.id);
    return {
      id: on.id,
      name: known?.name ?? on.name,
      creditLimitMinor: known?.creditLimitMinor ?? null,
      priceTier: known?.priceTier,
    };
  });
  const [history, setHistory] = useState(false);
  // The total when the customer was picked: if it moves after (wholesale or contract prices), the cashier is told
  const [totalAtPick, setTotalAtPick] = useState<number | null>(null);
  // A device with a warranty is sold to a known customer (the store's setting): the picker opens first
  const needsCustomer = warrantyAsksCustomer(settings.till, settings.sectors) && hasWarrantyDevice(cart);
  const [picking, setPicking] = useState(needsCustomer);
  // On a phone the required customer is a one-line banner under the methods; tapping it opens the picker, so the methods stay in view
  const phone = useIsPhone();
  const [pickerOpen, setPickerOpen] = useState(false);
  const collapsedPicker = phone && needsCustomer && !customer && !pickerOpen;
  // This till's own documents, for the vouchers it issued or spent that the server has not sent back
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [pos.store]);
  // What the picked customer owes now, as the server says (online only); null while unknown
  const [owed, setOwed] = useState<number | null>(null);
  const customerId = customer?.id ?? null;
  useEffect(() => {
    setOwed(null);
    const token = pos.device.token;
    if (!customerId || !token || !pos.online()) return;
    let alive = true;
    void fetchPurchases(customerId, token, pos.fetch).then(
      (got) => alive && setOwed(got?.balanceMinor ?? null),
    );
    return () => {
      alive = false;
    };
  }, [customerId, pos]);
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
    // A customer a rep added and the supervisor has not approved yet is sold to for cash only
    const unapproved = customer
      ? cashOnly(catalog.customers.find((c) => c.id === customer.id)?.approvalStatus)
      : false;
    if (customer && unapproved) {
      // cash, card and the rest only: no account and no cheque
    } else if (customer && canCredit) {
      list.push({ key: 'credit', method: 'credit', currency: base, label: 'آجل على الحساب', rate: null });
      list.push({ key: 'cheque', method: 'cheque', currency: base, label: 'شيك', rate: null });
    } else if (customer && staff) {
      // Without the permission the sale on account goes within the customer's limit, or once a manager
      // allows it; a cheque goes once a manager allows it
      const limit = customer.creditLimitMinor;
      const within = limit !== null && owed !== null && owed < limit;
      list.push({
        key: 'credit',
        method: 'credit',
        currency: base,
        label: within ? 'آجل على الحساب' : 'على الحساب (بموافقة المدير)',
        rate: null,
      });
      list.push({
        key: 'cheque',
        method: 'cheque',
        currency: base,
        label: 'شيك (بموافقة المدير)',
        rate: null,
      });
    }
    return list;
  }, [
    base,
    settings.enabledCurrencies,
    catalog.rates,
    catalog.collectRates,
    catalog.customers,
    customer,
    canCredit,
    staff,
    hasVouchers,
    loyalty,
    points,
    owed,
  ]);
  // An exchange opens on the voucher of the return just saved
  const [option, setOption] = useState<PayOption>(cart.voucher ? VOUCHER_OPTION(base) : options[0]!);
  // Who is asked for a manager's code now: a sale on account or by cheque, or one under cost
  const [approving, setApproving] = useState<'credit' | 'cost' | 'down' | null>(null);
  const [creditGrant, setCreditGrant] = useState<Approval | null>(null);
  const [costGrant, setCostGrant] = useState<Approval | null>(null);
  const [split, setSplit] = useState(false);
  // A voucher or deposit took its part: the next part starts at what is left, until the cashier changes it
  const [restPrefill, setRestPrefill] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  // A customer named before the pay screen (a held sale, a ticket): their contract prices apply here too, once
  const contractAsked = useRef(false);
  useEffect(() => {
    if (contractAsked.current || !customer || !onContractPrices) return;
    if (cart.contractPriced || cart.quotation || cart.rental || cart.maintenance || cart.alteration) return;
    contractAsked.current = true;
    setTotalAtPick((at) => at ?? totalMinor);
    void onContractPrices(customer.id).then((applied) => applied && setParts([]));
  }, [customer, cart, onContractPrices, totalMinor]);
  const planStands =
    plan !== null &&
    customer !== null &&
    plan.goodsTotalMinor === goodsTotalMinor &&
    parts.some((p) => p.tender.method === 'credit' && p.tender.amountMinor === plan.financedMinor);
  // A plan half-built stays on the device with the cart: a reload of the till brings it back when the
  // same customer and the same goods are still on the cart. When it cannot come back (or was dropped
  // by a change of the cart), paying without it asks first, so nobody finishes it as a cash sale by mistake
  const [planLost, setPlanLost] = useState(false);
  const [askNoPlan, setAskNoPlan] = useState(false);
  const [planRestored, setPlanRestored] = useState(false);
  const planChecked = useRef(false);
  useEffect(() => {
    if (plan && !planStands) {
      setPlan(null);
      setPlanLost(true);
    }
  }, [plan, planStands]);
  useEffect(() => {
    if (planChecked.current || !customer) return;
    planChecked.current = true;
    void pos.local.get<SavedPlan>(PLAN_KEY).then((saved) => {
      if (!saved) return;
      if (saved.customerId === customer.id && saved.draft.goodsTotalMinor === goodsTotalMinor) {
        applyPlan(saved.draft);
        setPlanRestored(true);
      } else {
        void pos.local.remove(PLAN_KEY);
      }
    });
    // once, when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);
  useEffect(() => {
    if (plan && planStands && customer) {
      void pos.local.set(PLAN_KEY, {
        customerId: customer.id,
        draft: plan,
      } satisfies SavedPlan);
    }
  }, [plan, planStands, customer, pos.local]);
  function applyPlan(draft: PlanDraft) {
    setPlanLost(false);
    setAskNoPlan(false);
    setPlan(draft);
    setPlanning(false);
    setSplit(true);
    setRestPrefill(true);
    setParts([
      { option: ACCOUNT_OPTION(base), tender: tenderOf(ACCOUNT_OPTION(base), draft.financedMinor, '') },
    ]);
    setOption(options[0]!);
    setText('');
    setReference('');
    setError(null);
  }
  function cancelPlan() {
    void pos.local.remove(PLAN_KEY);
    setPlanRestored(false);
    setPlan(null);
    setParts((list) => list.filter((p) => p.tender.method !== 'credit'));
    setRestPrefill(false);
  }
  const [text, setText] = useState('');
  const [reference, setReference] = useState(cart.voucher ?? '');
  // A cheque's details: bank, number, due day, and whose it is when not the customer's
  const [chequeBank, setChequeBank] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDue, setChequeDue] = useState('');
  const [chequeDrawer, setChequeDrawer] = useState('');
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
          : // Cash in the sale's currency starts at the exact due (to the cash step): typing replaces it; a split types its parts
            (!split || restPrefill) && option.currency === base
            ? roundCashDue(remainingBase, cashSteps[base] ?? 0).dueMinor
            : // Cash in a foreign currency starts at the due converted to it, so the box and «المتبقي» agree
              (!split || restPrefill) && option.method === 'cash'
              ? dueIn(option.currency, base, remainingBase, ctx.rates)
              : null);
  const chequeDetails =
    option.method === 'cheque' && chequeBank.trim() && chequeNo.trim() && chequeDue
      ? {
          bank: chequeBank.trim(),
          number: chequeNo.trim(),
          dueDate: chequeDue,
          drawer: chequeDrawer.trim() || null,
        }
      : null;
  const current =
    amount && amount > 0
      ? tenderOf(
          option,
          amount,
          option.method === 'cheque'
            ? chequeDetails
              ? chequeReference(chequeDetails)
              : ''
            : voucher
              ? voucher.code
              : reference,
          chequeDetails,
        )
      : null;
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
  // What this sale puts on the customer's account, in the store's currency (paid now = the total less it)
  const onAccountMinor =
    'error' in settlement || !settlement.covered
      ? 0
      : tenders.filter((t) => t.method === 'credit').reduce((sum, t) => sum + t.amountMinor, 0);
  // A sale on account against the customer's limit: what it takes them over by, before any code is asked
  const creditAmount = tenders
    .filter((t) => t.method === 'credit')
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const creditLimit = customer?.creditLimitMinor ?? null;
  const overBy =
    creditLimit !== null && owed !== null && creditAmount > 0
      ? Math.max(0, owed + creditAmount - creditLimit)
      : 0;
  const withinLimit = creditLimit !== null && owed !== null && overBy === 0;
  const overPolicy = settings.till?.creditOverLimit ?? 'approve';
  const blockedOver = overBy > 0 && overPolicy === 'block';
  // Under cost: the lines the till knows the average cost of and prices under it
  const belowCost = cart.lines.filter(
    (l) => typeof l.costMinor === 'number' && l.priceMinor < lineGross(l.costMinor, l.packQty),
  );
  // A card's approval number is asked for only when the store's settings say so
  const cardApproval = settings.till?.cardApprovalRequired ?? false;
  const needsReference =
    nonCash &&
    option.method !== 'credit' &&
    option.method !== 'points' &&
    (option.method !== 'card' || cardApproval) &&
    current !== null &&
    current.reference === null;
  const onAccount = (method: string) => method === 'credit' || method === 'cheque' || method === 'points';
  const canComplete =
    !saving &&
    !('error' in settlement) &&
    settlement.covered &&
    !needsReference &&
    !voucherProblem &&
    !blockedOver &&
    !(needsCustomer && !customer) &&
    tenders.length > 0;

  // Why «أتمّ الدفع» waits, said beside it: one short line for whatever holds it
  const waitingFor: string | null =
    canComplete || saving
      ? null
      : needsCustomer && !customer
        ? 'اختر الزبون أولاً: الجهاز المباع بكفالة يُسجَّل باسمه.'
        : blockedOver
          ? 'المبلغ يتجاوز حدّ دين هذا الزبون.'
          : voucherProblem
            ? 'تحقّق من القسيمة أو النقاط المكتوبة.'
            : needsReference
              ? option.method === 'cheque'
                ? 'اكتب البنك ورقم الشيك وتاريخ الاستحقاق.'
                : 'اكتب رقم الموافقة أو المرجع لهذه الدفعة.'
              : tenders.length === 0
                ? `أدخل المبلغ المدفوع (${option.label}).`
                : 'error' in settlement
                  ? 'تحقّق من المبلغ المكتوب.'
                  : !settlement.covered
                    ? customer &&
                      options.some((o) => o.method === 'credit') &&
                      !tenders.some((t) => t.method === 'credit')
                      ? 'المبلغ لا يغطي الفاتورة كلها. اضغط «آجل على الحساب» ليُسجَّل المتبقي ديناً على الزبون.'
                      : 'المبلغ لا يغطي الفاتورة كلها بعد.'
                    : null;

  const extrasRef = useRef<HTMLDivElement>(null);
  const goToMissing = () => {
    if (needsCustomer && !customer) {
      setPicking(true);
      setPickerOpen(true);
    } else if (needsReference) referenceRef.current?.focus();
    extrasRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  // Cash in the sale's own currency is due rounded to the cash step: the same figure the footer shows
  const dueHere =
    option.method === 'cash' && option.currency === base
      ? roundCashDue(remainingBase, cashSteps[base] ?? 0).dueMinor
      : dueIn(option.currency, base, remainingBase, ctx.rates);
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
    setRestPrefill(true);
    setParts([{ option: voucherOption, tender: tenderOf(voucherOption, found.balanceMinor, found.code) }]);
    setOption(options[0]!);
    setReference('');
  }, [cart.voucher, entries, vouchers, totalMinor, base, options]);

  function clearCheque() {
    setChequeBank('');
    setChequeNo('');
    setChequeDue('');
    setChequeDrawer('');
  }

  function pick(next: PayOption) {
    // A part typed and short of the total, then «آجل على الحساب»: the typed cash is kept as a part and the account
    // takes the rest, never the whole invoice in its place (round 39)
    const toCredit =
      !split &&
      next.method === 'credit' &&
      option.method === 'cash' &&
      !('error' in settlement) &&
      !settlement.covered;
    // A split part typed and not yet added is kept: choosing another method adds it first
    if (
      (split || toCredit) &&
      text &&
      current &&
      !voucherProblem &&
      !needsReference &&
      next.key !== option.key
    ) {
      setParts((list) => [...list, { option, tender: current }]);
      if (toCredit) setSplit(true);
    }
    setOption(next);
    setText('');
    setReference('');
    clearCheque();
    setError(null);
    if (next.method !== 'cash')
      setTimeout(() => {
        referenceRef.current?.focus();
        // On a phone the fields sit below the methods: bring them into view
        if (next.method === 'cheque') referenceRef.current?.scrollIntoView?.({ block: 'center' });
      }, 0);
  }

  function addPart() {
    if (!current || voucherProblem) return;
    setParts((list) => [...list, { option, tender: current }]);
    setRestPrefill(false);
    setText('');
    setReference('');
    clearCheque();
  }

  async function complete(grant: { credit?: Approval; cost?: Approval } = {}, skipPlanAsk = false) {
    if (!canComplete) {
      if ('error' in settlement) setError(settlement.error);
      else if (blockedOver) setError('هذا الزبون يتجاوز حد الدين، ولا يُباع له بالآجل فوق الحد.');
      else if (voucherProblem) setError(voucherProblem);
      else if (needsReference) {
        setError(
          option.method === 'cheque'
            ? 'اكتب البنك ورقم الشيك وتاريخ استحقاقه.'
            : `اكتب ${REFERENCE_LABEL[option.method]}.`,
        );
      }
      return;
    }
    // A cashier without «البيع بالآجل» needs a manager's code for a cheque, and for a sale on account
    // unless it stays within the customer's limit; over the limit a code is asked of everyone who
    // cannot sell on account themselves
    const approved = grant.credit ?? creditGrant;
    const onCredit = tenders.some((t) => t.method === 'credit');
    const onCheque = tenders.some((t) => t.method === 'cheque');
    if (!canCredit && !approved && ((onCredit && !withinLimit) || onCheque)) {
      setApproving('credit');
      return;
    }
    // A line under its cost: a manager's code when the store's settings ask for it
    const costApproved = grant.cost ?? costGrant;
    if (belowCost.length > 0 && settings.till?.belowCostApproval && !costApproved) {
      setApproving('cost');
      return;
    }
    if (planLost && !(plan && planStands) && !skipPlanAsk) {
      setAskNoPlan(true);
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
      const built = buildSalePayload({
        ...pricingInput(saleCart, ctx),
        shiftId,
        cashierId,
        payments: tenders,
        cashSteps,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        salespersonId,
        service,
        onlineOrderId: cart.onlineOrder?.id ?? null,
        salesOrderId: cart.salesOrder?.id ?? null,
        prescription:
          cart.prescription && Object.values(cart.prescription).some(Boolean) ? cart.prescription : null,
      });
      const extra = {
        ...(approved && (onCredit || onCheque) ? { creditApproval: approved } : {}),
        // The manager who allowed a batch the till would not sell (an expired one): the server audits it (round 38)
        ...(cart.batchApproval ? { batchApproval: cart.batchApproval.approval } : {}),
        // The balance the receipt prints under a sale on account
        ...(onCredit && owed !== null ? { customerBalanceAfterMinor: owed + creditAmount } : {}),
        ...(plan && planStands ? { installmentPlan: plan.plan } : {}),
      };
      const payload = { ...built, ...extra };
      const entry = await pos.save({
        type: 'sale',
        payload: payload as unknown as Record<string, unknown>,
        businessDate,
        engineVersion: PRICING_ENGINE_VERSION,
      });
      void pos.local.remove(PLAN_KEY);
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
  // While the manager types their code, the keys are theirs
  const approvingRef = useRef(approving !== null);
  approvingRef.current = approving !== null;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || pickingRef.current || approvingRef.current)
        return;
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

  // Shown only while the latest settings still offer that currency
  const shownRate = catalog.rates.find((r) =>
    settings.enabledCurrencies.includes(r.unit === base ? r.quote : r.unit),
  );
  const foreign = shownRate ? (shownRate.unit === base ? shownRate.quote : shownRate.unit) : null;
  const changeMinor = 'error' in settlement ? 0 : (settlement.change?.amountMinor ?? 0);
  const short = 'error' in settlement || !settlement.covered;
  const shortCash = 'error' in settlement ? 0 : settlement.remainingCashMinor;

  return (
    <section
      aria-label="الدفع"
      className="@container/pay relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e2 motion-safe:animate-sheet-in"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-2 @max-lg/pay:gap-x-3 @max-lg/pay:px-3">
        {/* On a phone the tab «السلة» goes back: a second button for it is noise */}
        {phone ? null : (
          <Button
            variant="secondary"
            size="md"
            icon={<BackIcon size={20} />}
            aria-keyshortcuts="Escape"
            onClick={onBack}
          >
            ارجع للسلة
          </Button>
        )}
        {/* Where the panel is narrow (a 1024 px screen), the methods and the keys say it is the payment */}
        <h2 className="sr-only text-lg font-semibold text-ink @3xl/pay:not-sr-only">
          {split ? 'الدفع · مقسّم' : 'الدفع'}
        </h2>
        <span className="flex-1" />
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-ink-muted">
            {plan ? 'المطلوب مع رسم التقسيط' : 'المطلوب'}
          </span>
          <ExactMoney
            minor={totalMinor}
            currency={base}
            className="text-kpi font-bold tracking-tight text-ink @max-lg/pay:text-2xl"
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
        <div className="grid gap-4 @lg/pay:grid-cols-2 @lg/pay:grid-rows-[auto_1fr] @3xl/pay:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @3xl/pay:gap-5">
          {/* How the customer pays, who the customer is, and the parts paid so far */}
          <div
            className={cn(
              '@container flex min-w-0 flex-col gap-3',
              needsCustomer && !customer && '@lg/pay:row-start-2',
            )}
          >
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
                      'flex min-h-16 flex-col items-start gap-1.5 rounded-card border p-2.5 @max-lg/pay:min-h-12 @max-lg/pay:p-2 text-start transition-[background-color,border-color,box-shadow] duration-120 ease-standard select-none @xs:flex-row @xs:items-center @xs:gap-3 @xs:p-3',
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
            {customer && totalAtPick !== null && totalAtPick !== goodsTotalMinor ? (
              <Alert tone="info">
                تغيّر السعر حسب سعر الزبون: من <Money minor={totalAtPick} currency={base} /> إلى{' '}
                <Money minor={goodsTotalMinor} currency={base} />.
              </Alert>
            ) : null}
          </div>

          {/* What the customer hands over: the amount, the quick notes or the reference, the keys */}
          <div className="@container flex min-w-0 flex-col gap-2 @lg/pay:col-start-2 @lg/pay:row-span-2 @lg/pay:row-start-1 @3xl/pay:gap-3">
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
                      ? displayNumber(
                          amountText(shownAmount(amount, option.currency), option.currency),
                          digits,
                        )
                      : displayNumber('0', digits)}
                </span>
                <span className="shrink-0 text-lg font-semibold text-ink-subtle">
                  {CURRENCIES[option.currency].symbolAr}
                </span>
              </span>
            </div>
            {option.method === 'cash' && option.currency === base && dueHere !== remainingBase ? (
              <p role="status" aria-label="تقريب النقد" className="text-sm text-ink-muted">
                قُرّب المبلغ إلى{' '}
                <ExactMoney minor={dueHere} currency={base} className="font-semibold text-ink" /> (فرق{' '}
                <bdi dir="ltr" className="num">
                  {dueHere < remainingBase ? '−' : '+'}
                  <Money
                    minor={Math.abs(dueHere - remainingBase)}
                    currency={base}
                    symbol={false}
                    decimals={2}
                    trimZeros
                  />
                </bdi>
                )
              </p>
            ) : null}
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
                  {overBy > 0 ? (
                    <strong className="block font-semibold text-danger-ink">
                      يتجاوز حد الزبون بـ <Money minor={overBy} currency={base} />
                      {blockedOver ? '. لا يُباع له بالآجل فوق الحد.' : canCredit ? '.' : '. يلزم رمز مدير.'}
                    </strong>
                  ) : null}
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
            ) : option.method === 'cheque' ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <TextField
                    ref={referenceRef}
                    label="البنك"
                    value={chequeBank}
                    onChange={(event) => setChequeBank(event.target.value.slice(0, 60))}
                    autoComplete="off"
                  />
                  <TextField
                    label="رقم الشيك"
                    value={chequeNo}
                    onChange={(event) => setChequeNo(event.target.value.slice(0, 40))}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <DateField label="تاريخ الاستحقاق" value={chequeDue} onChange={setChequeDue} />
                  <TextField
                    label="اسم الساحب (اختياري)"
                    value={chequeDrawer}
                    onChange={(event) => setChequeDrawer(event.target.value.slice(0, 80))}
                    autoComplete="off"
                  />
                </div>
                {chequeDue &&
                chequeDue < businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff) ? (
                  <p role="alert" className="text-sm font-semibold text-warning-ink">
                    تاريخ الاستحقاق مضى — تأكّد.
                  </p>
                ) : null}
                {!canCredit ? (
                  <p className="text-sm text-ink-muted">قبول الشيك يحتاج رمز مدير عند الإتمام.</p>
                ) : null}
              </div>
            ) : option.method !== 'cash' ? (
              <>
                <TextField
                  ref={referenceRef}
                  label={`${REFERENCE_LABEL[option.method] ?? 'المرجع'}${
                    option.method === 'card' && !cardApproval ? ' (اختياري)' : ''
                  }`}
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
              // An even grid whatever the count: 3 and 6 in threes, 2 and 4 in twos, 5 as 3 over 2
              // (six columns, the second row's two wider), never a hole or a lone button on a row
              <div
                className={cn(
                  'grid gap-2',
                  quick.length === 1
                    ? 'grid-cols-1'
                    : quick.length === 2 || quick.length === 4
                      ? 'grid-cols-2'
                      : quick.length === 5
                        ? 'grid-cols-6'
                        : 'grid-cols-3',
                )}
              >
                {quick.map((value, index) => (
                  <Button
                    key={value}
                    variant="secondary"
                    size="md"
                    className={quick.length === 5 ? (index < 3 ? 'col-span-2' : 'col-span-3') : undefined}
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
            {belowCost.length > 0 ? (
              <p
                role="status"
                aria-label="بيع بأقل من التكلفة"
                className="flex items-start gap-2 rounded-card border border-warning/20 bg-warning-soft px-3 py-2.5 text-sm text-warning-ink"
              >
                <AlertCircleIcon size={20} className="shrink-0" />
                <span>
                  تنبيه: {belowCost.map((l) => l.name).join('، ')} بأقل من متوسط تكلفته.
                  {settings.till?.belowCostApproval ? ' يلزم رمز مدير عند الإتمام.' : ''}
                </span>
              </p>
            ) : null}
            <Keypad
              compact={phone}
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

          {/* Who the customer is, one payment or several, the parts paid: under the keys on a phone, so the amount and the notes stay in view; under the methods where the panel is wide */}
          <div
            ref={extrasRef}
            className={cn(
              '@container flex min-w-0 flex-col gap-3 @lg/pay:col-start-1',
              // A required customer comes first: the picker sits at the top, not under the methods and keys
              // On a phone the customer row is the first thing under the total, ahead of the methods
              '@max-lg/pay:order-first',
              needsCustomer && !customer ? '@lg/pay:row-start-1' : '@lg/pay:row-start-2',
            )}
          >
            {picking && collapsedPicker ? (
              <Button
                variant="secondary"
                size="md"
                icon={<UserIcon size={20} />}
                onClick={() => setPickerOpen(true)}
              >
                اختر الزبون (مطلوب)
              </Button>
            ) : picking ? (
              <CustomerPicker
                catalog={catalog}
                createdBy={cashierId}
                onPicked={(picked) => {
                  setTotalAtPick(totalMinor);
                  setCustomer(picked);
                  onCustomer?.({ id: picked.id, name: picked.name });
                  setPicking(false);
                  if (picked.priceTier === 'wholesale' && cart.priceTier !== 'wholesale') {
                    setParts([]);
                    onWholesaleCustomer?.();
                  }
                  void onContractPrices?.(picked.id).then((applied) => applied && setParts([]));
                }}
                onCancel={() => setPicking(false)}
              />
            ) : customer ? (
              <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-e1">
                {/* On a phone the whole name shows: the buttons drop to the next line instead of cutting it */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Avatar name={customer.name} />
                  <span className="flex min-w-40 flex-1 flex-col">
                    <span className="text-xs text-ink-muted">الزبون</span>
                    <span className="font-semibold break-words text-ink">{customer.name}</span>
                    {owed !== null && owed > 0 ? (
                      <span className="text-sm font-semibold text-danger-ink">
                        عليه <Money minor={owed} currency={base} />
                      </span>
                    ) : null}
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
                      onCustomer?.(null);
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
            {customer && installmentSettings.enabled && !plan && !cart.voucher && goodsTotalMinor > 0 ? (
              <Button
                variant="secondary"
                size="md"
                icon={<CalendarIcon size={20} />}
                onClick={() => setPlanning(true)}
              >
                بيع بالتقسيط
              </Button>
            ) : null}
            {planRestored && plan ? (
              <Alert tone="info">رجّعنا خطة التقسيط التي بدأتها قبل إعادة التحميل.</Alert>
            ) : null}
            {askNoPlan && !plan ? (
              <Alert tone="warning" title="بدأت خطة تقسيط ولم تكتمل">
                <span className="flex flex-col gap-2">
                  <span>تُتمّ البيعة الآن بدون تقسيط، والمبلغ كله يُدفع هنا. هل هذا ما تريده؟</span>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        setAskNoPlan(false);
                        setPlanLost(false);
                        void pos.local.remove(PLAN_KEY);
                        void complete({}, true);
                      }}
                    >
                      نعم، بدون تقسيط
                    </Button>
                    <Button
                      size="md"
                      onClick={() => {
                        setAskNoPlan(false);
                        setPlanning(true);
                      }}
                    >
                      ارجع للتقسيط
                    </Button>
                  </span>
                </span>
              </Alert>
            ) : null}
            {plan ? (
              <div
                role="status"
                aria-label="خطة التقسيط"
                className="flex flex-col gap-1 rounded-card border border-brand/30 bg-brand-soft/40 px-3 py-2.5 text-sm"
              >
                <span className="font-semibold text-ink">
                  تقسيط: <bdi className="num">{plan.plan.count}</bdi> أقساط · أول قسط{' '}
                  {dayText(plan.plan.firstDueDate, digits)}
                </span>
                <span className="text-ink-muted">
                  رسم التقسيط <Money minor={plan.markupMinor} currency={base} /> · على الحساب{' '}
                  <Money minor={plan.financedMinor} currency={base} className="font-semibold text-ink" />
                </span>
                <span className="text-ink-muted">المطلوب الآن هو الدفعة الأولى فقط.</span>
                <span>
                  <Button variant="ghost" size="md" onClick={cancelPlan}>
                    ألغِ التقسيط
                  </Button>
                </span>
              </div>
            ) : null}
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
                    setRestPrefill(false);
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
            {onAccountMinor > 0 && onAccountMinor < totalMinor ? (
              <p role="status" aria-label="ملخص الدفع" className="text-sm font-semibold text-ink-muted">
                مدفوع الآن <Money minor={totalMinor - onAccountMinor} currency={base} className="text-ink" />{' '}
                · آجل على الحساب <Money minor={onAccountMinor} currency={base} className="text-ink" /> ·
                المجموع <Money minor={totalMinor} currency={base} className="text-ink" />
              </p>
            ) : null}
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
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-3 @max-lg/pay:gap-y-1 border-t border-line bg-surface-total px-5 py-2 @3xl/pay:py-3">
        <div role="status" className="flex items-baseline gap-3">
          <span className="text-base font-semibold text-ink-muted @max-lg/pay:text-sm">
            {short ? 'المتبقي' : 'الباقي للزبون'}
          </span>
          <span
            className={cn(
              'text-kpi font-bold tracking-tight @max-lg/pay:text-2xl @3xl/pay:text-total',
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
        <span className="flex-1 @max-lg/pay:hidden" />
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
        {approving && staff ? (
          // A layer over the panel, scrolling by itself: in the footer the keypad overran a short screen
          <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-surface/95 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md">
              <ManagerCode
                staff={staff}
                permission={
                  approving === 'cost'
                    ? 'sale.discount_over_limit'
                    : approving === 'down'
                      ? 'installments.manage'
                      : 'sale.credit'
                }
                reason={
                  approving === 'down'
                    ? 'الدفعة الأولى أقل من الحد الأدنى للتقسيط، وتخفيضها يحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                    : approving === 'cost'
                      ? 'البيع بأقل من التكلفة يحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                      : tenders.some((t) => t.method === 'cheque')
                        ? 'قبول الشيك يحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                        : 'البيع على الحساب يزيد دين الزبون، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                }
                onApproved={(approval) => {
                  const kind = approving;
                  setApproving(null);
                  if (kind === 'down') {
                    if (pendingPlan) applyPlan(pendingPlan);
                    setPendingPlan(null);
                    return;
                  }
                  if (kind === 'cost') setCostGrant(approval);
                  else setCreditGrant(approval);
                  void complete(kind === 'cost' ? { cost: approval } : { credit: approval });
                }}
                onCancel={() => setApproving(null)}
              />
            </div>
          </div>
        ) : null}
        {waitingFor ? (
          // Tapping the reason goes to what is missing: the customer list, or the reference field
          <button
            type="button"
            id="pay-waiting"
            onClick={goToMissing}
            className="flex min-h-11 max-w-xs items-start gap-2 text-start text-sm font-semibold text-warning-ink @max-lg/pay:min-h-9 @max-lg/pay:order-first @max-lg/pay:max-w-none @max-lg/pay:basis-full"
          >
            <AlertCircleIcon size={20} className="shrink-0" />
            {waitingFor}
          </button>
        ) : null}
        <Button
          size="lg"
          icon={option.method === 'cash' ? <CashIcon size={20} /> : <CheckIcon size={20} />}
          aria-describedby={waitingFor ? 'pay-waiting' : undefined}
          aria-keyshortcuts="Enter"
          onClick={() => void complete()}
          disabled={!canComplete}
          loading={saving}
          className="@max-lg/pay:flex-1"
        >
          أتمّ الدفع
          <Kbd tone="brand">Enter</Kbd>
        </Button>
      </footer>
      {planning && customer ? (
        <InstalmentSheet
          goodsTotalMinor={goodsTotalMinor}
          base={base}
          today={businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff)}
          settings={installmentSettings}
          customerName={customer.name}
          planId={planId}
          onCancel={() => setPlanning(false)}
          onConfirm={(draft) => {
            if (draft.belowMinimum && !canCredit && staff) {
              setPendingPlan(draft);
              setPlanning(false);
              setApproving('down');
            } else applyPlan(draft);
          }}
        />
      ) : null}
    </section>
  );
}
