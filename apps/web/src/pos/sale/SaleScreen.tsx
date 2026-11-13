import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CURRENCIES } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import { businessDateOf, rateFor } from '@serva/core/sale';
import { promotionActive } from '@serva/core/promotions';
import { parseScaleBarcode, qtyForPrice } from '@serva/core/scale';
import { missingPrescription, pickBatch, prescriptionNeed } from '@serva/core/pharmacy';
import type { OutboxEntry } from '@serva/sync';
import {
  AddIcon,
  Badge,
  BarcodeIcon,
  Button,
  CalendarIcon,
  CartIcon,
  CartLine,
  CashierShell,
  ClockIcon,
  CloseIcon,
  cn,
  DeleteIcon,
  displayNumber,
  EmptyState,
  formatQuantity,
  IconButton,
  IconChip,
  InboxIcon,
  KeyIcon,
  Money,
  OfferIcon,
  PercentIcon,
  PrintIcon,
  RemoveIcon,
  Select,
  SendIcon,
  Tooltip,
  TotalPanel,
  UndoIcon,
  useDigits,
  WarningIcon,
  WeighedIcon,
} from '@serva/ui';
import { barcodeKey, type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { counted } from '../format';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { AdjustPanel, NEED_TEXT, type AdjustMode, type AdjustValue } from './AdjustPanel';
import {
  addItem,
  invoiceNeed,
  lineNeed,
  pieceCount,
  kitchenLines,
  markSent,
  missingSerials,
  priceCart,
  setPriceTier,
  type ItemChoice,
  EMPTY_CART,
  removeLine,
  restoreLine,
  unitPriceOf,
  updateLine,
  type ApprovalNeed,
  type ApprovalRules,
  type Cart,
  type CartLine as Line,
  type PricedCart,
  type PricingContext,
} from './cart';
import { useScanner } from './useScanner';
import { usePos } from '../services';
import { PrintableQuote, type QuoteData } from '../receipt/Quote';
import { ORDER_TYPE_TEXT, PrintableKitchenTicket, type KitchenData } from '../receipt/KitchenTicket';
import { ModifierPanel } from './ModifierPanel';
import { modelPieces, orderPieces } from './models';
import { VariantPicker } from './VariantPicker';
import { TableBoard } from './TableBoard';
import type { SavedGiftVoucher } from '../customers/GiftVoucherScreen';
import { HoldPanel } from './HoldPanel';
import { HeldList, HoldNamePanel } from './HeldList';
import { ItemsArea, type PriceCheck } from './ItemsArea';
import { OnlineOrdersPanel } from './OnlineOrdersPanel';
import { ONLINE_SOLD_KEY, orderCart, waitingOrders } from './onlineOrders';
import { SerialPanel } from './SerialPanel';
import { PrescriptionPanel } from './PrescriptionPanel';
import { Kbd } from './Kbd';
import { SalePanel } from './SalePanel';

const PaymentPanel = lazy(() => import('../pay/PaymentPanel').then((m) => ({ default: m.PaymentPanel })));

export type SaleMode =
  | { kind: 'items' }
  | { kind: 'line'; lineNo: number; adjust: AdjustMode }
  | { kind: 'invoice' }
  | { kind: 'approve'; lineNo: number | null; need: ApprovalNeed }
  | { kind: 'pay' }
  | { kind: 'done' }
  | { kind: 'help' }
  | { kind: 'choose'; item: CatalogItem; hit: BarcodeHit | null }
  | { kind: 'tables' }
  | { kind: 'online' }
  | { kind: 'hold' }
  | { kind: 'holdName' }
  | { kind: 'heldList' }
  | { kind: 'check' }
  | { kind: 'serial'; lineNo: number }
  | { kind: 'rx' }
  | { kind: 'pick'; productId: string };

export interface SaleScreenProps {
  statusBar: ReactNode;
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shiftId: string;
  cart: Cart;
  setCart: (update: (cart: Cart) => Cart) => void;
  heldCount: number;
  /** The held carts, for the list to pick from */
  heldList?: readonly Cart[];
  /** Puts the cart aside under an optional name */
  onHold: (name?: string) => void;
  /** Brings a held cart back (the last one when none is named) */
  onResume: (index?: number) => void;
  onDiscardHeld?: (index: number) => void;
  /** The held orders, for the table board */
  heldCarts?: readonly Cart[];
  /** Opens a table's order, or starts one there (CashierApp keeps the held orders) */
  onOpenTable?: (table: string) => void;
  /** The order just sent to the kitchen, before it is marked sent (online, the server gets it too) */
  onKitchenSent?: (cart: Cart) => void;
  /** The last sale's lines, for «كرّر آخر طلب» */
  lastLines: { variantId: string; barcode: string | null; qty: number }[];
  onSaved: (entry: OutboxEntry) => void;
  /** The finished sale's screen, shown in place of the items until the next sale starts */
  done: ReactNode | null;
  onNextSale: () => void;
  /** Keyboard actions that belong to the cashier app (menu, lock) */
  extraShortcuts?: (event: KeyboardEvent) => boolean;
  /** Prints a hold's deposit voucher (CashierApp's printer) */
  onPrintDeposit?: (saved: SavedGiftVoucher) => void;
}

const SELLER_KEY = 'salesperson';

const SHORTCUTS: [string, string][] = [
  ['ابحث أو امسح', 'F2 أو /'],
  ['علّق الفاتورة، أو افتح المعلّقة', 'F4 أو Alt+3'],
  ['اسأل عن سعر صنف', 'F9'],
  ['ادفع', 'F12 أو +'],
  ['أتمّ الدفع', 'Enter'],
  ['خصم على الفاتورة', 'Alt+1'],
  ['حركات الدرج', 'Alt+7'],
  ['اقفل الشاشة', 'Alt+L'],
  ['الكمية قبل المسح', '3 ثم *'],
  ['ارجع للأصناف', 'Esc'],
  ['هذا الدليل', '؟'],
];

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The sale screen (kit cashier/Sale, Main): the cart on the right with its total and «ادفع», the
 * items on the left with search, category chips and the grid. The scanner works from any state;
 * quantity, discounts, price, the manager's code and the payment open in the items area beside
 * the cart, never as a dialog over another.
 */
export function SaleScreen(props: SaleScreenProps) {
  const { session, catalog, staff, cart, setCart } = props;
  const digits = useDigits();
  const settings = catalog.settings!;
  // The promotions running now, read again with every change to the cart so an hour's offer starts
  // and stops on time.
  const activePromotions = useMemo(() => {
    const now = new Date();
    return catalog.promotions.filter((p) => promotionActive(p, now, settings.timezone));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cart is the clock's tick
  }, [catalog.promotions, settings.timezone, cart]);
  const ctx = useMemo<PricingContext>(
    () => ({
      currency: settings.baseCurrency,
      taxInclusive: settings.taxInclusive,
      rates: catalog.rates,
      promotions: activePromotions,
    }),
    [settings.baseCurrency, settings.taxInclusive, catalog.rates, activePromotions],
  );
  const rules = useMemo<ApprovalRules>(
    () => ({
      maxDiscountBp: session.permissions.has('sale.discount') ? session.maxDiscountBp : 0,
      overLimitAllowed: session.permissions.has('sale.discount_over_limit'),
    }),
    [session],
  );
  const [mode, setMode] = useState<SaleMode>({ kind: 'items' });
  const [selected, setSelected] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'info'; text: string } | null>(null);
  const [removed, setRemoved] = useState<{ line: Line; index: number } | null>(null);
  const [bump, setBump] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [kitchen, setKitchen] = useState<KitchenData | null>(null);
  // «سعر صنف»: looks an item up (price per size and colour, stock) without adding it to the cart
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<PriceCheck | null>(null);
  const checkingRef = useRef(false);
  checkingRef.current = checking;
  // On a phone the cart and the items are two tabs; anything that opens in the items area shows it
  const [phoneView, setPhoneView] = useState<'items' | 'cart'>('items');
  // «البائع» (03 › الملابس: عمولة البائع): the last one picked on this device stays picked
  const pos = usePos();
  const [seller, setSeller] = useState<string>(session.userId);
  useEffect(() => {
    let alive = true;
    void pos.local.get<string>(SELLER_KEY).then((id) => {
      if (alive && id && staff.some((m) => m.id === id)) setSeller(id);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, staff]);
  // Online orders this till sold, until the next pull says they are done
  const [soldOnline, setSoldOnline] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void pos.local.get<string[]>(ONLINE_SOLD_KEY).then((ids) => {
      if (alive && ids) setSoldOnline(ids);
    });
    return () => {
      alive = false;
    };
  }, [pos.local]);
  const waitingOnline = waitingOrders(catalog.onlineOrders, soldOnline);
  const service = settings.service ?? null;
  // A café with no tables serves takeaway unless told otherwise
  const defaultOrderType = service && service.tables.length === 0 ? 'takeaway' : 'dine_in';
  const searchRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  const priced: PricedCart | null = useMemo(() => {
    if (cart.lines.length === 0) return null;
    try {
      return priceCart(cart, ctx);
    } catch {
      return null;
    }
  }, [cart, ctx]);
  const needs = useMemo(() => {
    const map = new Map<number, ApprovalNeed>();
    if (!priced) return map;
    cart.lines.forEach((line, i) => {
      const need = lineNeed(line, priced.lines[i]!.priced, ctx, rules);
      if (need) map.set(line.lineNo, need);
    });
    return map;
  }, [cart, priced, ctx, rules]);
  const invoiceNeeds = priced ? invoiceNeed(cart, priced.priced, rules) : null;
  const totalMinor = priced?.priced.totals.totalMinor ?? 0;
  const unnumbered = missingSerials(cart);
  const blocked = needs.size > 0 || invoiceNeeds !== null || unnumbered.length > 0;
  const canPay = cart.lines.length > 0 && priced !== null && !blocked;

  const showDone = props.done !== null && cart.lines.length === 0;
  const effectiveMode: SaleMode = showDone && mode.kind === 'items' ? { kind: 'done' } : mode;

  // ── Adding items ────────────────────────────────────────────────────────────────────────────
  const add = useCallback(
    (item: CatalogItem, hit?: BarcodeHit | null, weighedQty?: number, choice?: ItemChoice) => {
      // An item with modifiers asks for its choices first (beside the cart, not over it)
      if (item.modifiers?.length && weighedQty === undefined && !choice) {
        setMode({ kind: 'choose', item, hit: hit ?? null });
        return;
      }
      if (item.price.currency !== ctx.currency) {
        try {
          rateFor(ctx.rates, item.price.currency, ctx.currency);
        } catch {
          setNotice({
            tone: 'warning',
            text: `لا يوجد سعر صرف لـ${CURRENCIES[item.price.currency].nameAr} على هذا الجهاز، فلا يُباع «${item.name}» الآن.`,
          });
          return;
        }
      }
      // 03 › الصيدليات: a controlled drug is the pharmacist's alone
      if (item.controlled && !session.permissions.has('pharmacy.controlled')) {
        setNotice({
          tone: 'warning',
          text: `«${item.name}» دواء مراقَب، لا يبيعه إلا الصيدلاني.`,
        });
        return;
      }
      // …and no box of an expired batch goes out: the nearest batch that is still good is taken
      const today = businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff);
      const pick = settings.pharmacy ? pickBatch(item.shelfBatches, today) : { kind: 'none' as const };
      if (pick.kind === 'expired') {
        setNotice({
          tone: 'warning',
          text: `لا يُباع «${item.name}»: كل دفعاته على الرف منتهية الصلاحية (آخرها ${pick.latest}).`,
        });
        return;
      }
      const batch = pick.kind === 'ok' ? pick.batch : null;
      const qty = weighedQty ?? (multiplier ?? 1) * 1000;
      setMultiplier(null);
      setNotice(null);
      if (props.done) props.onNextSale();
      // From the latest cart, so scans arriving before the next render all count.
      const current = cartRef.current;
      const next = addItem(current, item, hit, qty, choice ?? null, batch);
      cartRef.current = next;
      setCart(() => next);
      const added = next.lines.find((l, i) => l !== current.lines[i])?.lineNo ?? null;
      setBump(added);
      // 03 › الصيدليات: what is on the shelf may have expired, or soon will
      const expiry = batch ? batch.expiry : item.nearestExpiry;
      if (expiry) {
        const soon = businessDateOf(
          Date.now() + 30 * 86_400_000,
          settings.timezone,
          settings.businessDayCutoff,
        );
        if (expiry < today) {
          setNotice({
            tone: 'warning',
            text: `صلاحية «${item.name}» انتهت في ${expiry} حسب آخر استلام. تأكد من العلبة قبل البيع.`,
          });
        } else if (expiry <= soon) {
          setNotice({
            tone: 'info',
            text: batch?.batchNo
              ? `صلاحية «${item.name}» (دفعة ${batch.batchNo}) تنتهي في ${expiry}.`
              : `صلاحية «${item.name}» تنتهي في ${expiry}.`,
          });
        }
      }
      if (item.tracksSerial && added !== null) {
        setSelected(added);
        setMode({ kind: 'serial', lineNo: added });
      } else if (item.unit?.allowsFraction && added !== null && weighedQty === undefined) {
        setSelected(added);
        setMode({ kind: 'line', lineNo: added, adjust: 'qty' });
      } else if (mode.kind === 'pay' || mode.kind === 'done' || mode.kind === 'help') {
        setMode({ kind: 'items' });
      }
    },
    [
      ctx,
      multiplier,
      setCart,
      mode.kind,
      props,
      settings.timezone,
      settings.businessDayCutoff,
      settings.pharmacy,
      session.permissions,
    ],
  );

  const scan = useCallback(
    (raw: string) => {
      const code = barcodeKey(raw);
      const hit = catalog.byBarcode.get(code);
      // «سعر صنف»: a scan shows the item's price and stock, and adds nothing
      const take = (item: CatalogItem, h: BarcodeHit | null, qty?: number) => {
        if (checkingRef.current) handlers.current.showPrice(item);
        else add(item, h, qty);
      };
      if (hit) {
        take(hit.item, hit);
        return;
      }
      // A scale label: the item's number on the scale, then its weight or its price.
      const reading = settings.scaleBarcode ? parseScaleBarcode(code, settings.scaleBarcode) : null;
      const weighed = reading ? catalog.byBarcode.get(reading.itemCode) : undefined;
      if (reading && weighed) {
        if (reading.kind === 'weight') {
          take(weighed.item, weighed, reading.qty);
          return;
        }
        const { currency, priceMinor } = weighed.item.price;
        let unitMinor = 0;
        try {
          unitMinor = convert(priceMinor, currency, ctx.currency, rateFor(ctx.rates, currency, ctx.currency));
        } catch {
          unitMinor = 0;
        }
        if (unitMinor > 0) {
          take(weighed.item, weighed, qtyForPrice(reading.priceMinor, unitMinor));
          return;
        }
      }
      if (reading && !weighed) {
        setNotice({
          tone: 'warning',
          text: `ملصق ميزان لصنف رقمه ${reading.itemCode}، ولا يوجد منتج بهذا الباركود. أضف الرقم باركوداً للمنتج.`,
        });
        return;
      }
      setNotice({
        tone: 'warning',
        text: `الباركود ${code} غير معروف على هذا الجهاز. ابحث عن الصنف باسمه.`,
      });
    },
    [catalog, add, settings.scaleBarcode, ctx],
  );

  const keypadOpen =
    mode.kind === 'line' ||
    mode.kind === 'invoice' ||
    mode.kind === 'approve' ||
    mode.kind === 'serial' ||
    mode.kind === 'rx' ||
    mode.kind === 'holdName' ||
    mode.kind === 'heldList';
  // While paying, amounts are typed and confirmed with Enter: only a full barcode counts as a scan.
  useScanner({
    enabled: !keypadOpen,
    onScan: scan,
    onMultiplier: setMultiplier,
    minLength: mode.kind === 'pay' ? 8 : 3,
  });

  // A quote prints once it is on the page, then leaves it.
  useEffect(() => {
    if (!quote) return;
    window.print();
    setQuote(null);
  }, [quote]);
  useEffect(() => {
    if (!kitchen) return;
    window.print();
    setKitchen(null);
  }, [kitchen]);
  // A panel (quantity, discount, payment…) opens in the items area: on a phone, show that tab
  useEffect(() => {
    if (mode.kind !== 'items') setPhoneView('items');
  }, [mode.kind]);
  useEffect(() => {
    if (bump === null) return;
    const timer = setTimeout(() => setBump(null), 900);
    return () => clearTimeout(timer);
  }, [bump]);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 5000);
    return () => clearTimeout(timer);
  }, [removed]);

  const pieces = useMemo(() => modelPieces(catalog.items), [catalog.items]);
  // «سعر الجملة» shows only where some item has a wholesale price (a clothing shop has none).
  const hasWholesale = useMemo(
    () => catalog.items.some((item) => (item.price.wholesalePriceMinor ?? null) !== null),
    [catalog.items],
  );
  const inCart = useMemo(() => new Set(cart.lines.map((l) => l.variantId)), [cart.lines]);
  /** What the cart holds of each piece, thousandths (taken off the stock the picker shows) */
  const inCartQty = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart.lines)
      map.set(l.variantId, (map.get(l.variantId) ?? 0) + (l.qty * l.packQty) / 1000);
    return map;
  }, [cart.lines]);

  /** Shows an item's price and stock (all its sizes and colours) and adds nothing */
  const showPrice = useCallback(
    (item: CatalogItem) => {
      const model = pieces.get(item.productId);
      setCheck({
        name: model ? (model[0]!.productName ?? item.name) : item.name,
        pieces: model ? orderPieces(model) : [item],
        focus: item.variantId,
      });
    },
    [pieces],
  );

  // The tiles and the search field call these; they stay the same function while the cart changes,
  // so the memoised grid is not drawn again for it.
  const handlers = useRef({ add, scan, showPrice });
  handlers.current = { add, scan, showPrice };
  const pickItem = useCallback((item: CatalogItem, hit?: BarcodeHit | null) => {
    if (checkingRef.current) handlers.current.showPrice(item);
    else handlers.current.add(item, hit);
  }, []);
  const pickModel = useCallback(
    (productId: string) => {
      if (checkingRef.current) {
        const model = pieces.get(productId);
        if (model)
          setCheck({
            name: model[0]!.productName ?? model[0]!.name,
            pieces: orderPieces(model),
            focus: null,
          });
      } else setMode({ kind: 'pick', productId });
    },
    [pieces],
  );
  const scanCode = useCallback((code: string) => handlers.current.scan(code), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const repeatLast = useCallback(() => {
    for (const l of props.lastLines) {
      const hit = l.barcode ? catalog.byBarcode.get(l.barcode) : undefined;
      const item = hit?.item ?? catalog.byVariant.get(l.variantId);
      if (item) setCart((c) => addItem(c, item, hit ?? null, l.qty));
    }
    if (props.done) props.onNextSale();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the props of this render
  }, [props.lastLines, props.done, catalog, setCart]);
  const startChecking = useCallback(() => {
    setMode({ kind: 'items' });
    setChecking(true);
    searchRef.current?.focus();
  }, []);
  const stopChecking = useCallback(() => {
    setChecking(false);
    setCheck(null);
  }, []);

  // ── Line and invoice changes ────────────────────────────────────────────────────────────────
  function remove(lineNo: number) {
    const index = cart.lines.findIndex((l) => l.lineNo === lineNo);
    if (index < 0) return;
    setRemoved({ line: cart.lines[index]!, index });
    setCart((c) => removeLine(c, lineNo));
    setSelected(null);
    if (mode.kind !== 'items') setMode({ kind: 'items' });
  }

  function changeQty(line: Line, delta: number) {
    const qty = line.qty + delta * 1000;
    if (qty <= 0) remove(line.lineNo);
    else setCart((c) => updateLine(c, line.lineNo, { qty }));
  }

  const lineOf = (lineNo: number) => cart.lines.find((l) => l.lineNo === lineNo) ?? null;

  function checkLine(line: Line, value: AdjustValue): { error: string } | { need: ApprovalNeed | null } {
    const patch = linePatch(line, value);
    const candidate = { ...line, ...patch, approval: null };
    try {
      const { lines } = priceCart(
        { ...cart, lines: cart.lines.map((l) => (l.lineNo === line.lineNo ? candidate : l)) },
        ctx,
      );
      const index = cart.lines.findIndex((l) => l.lineNo === line.lineNo);
      if (value.mode === 'price' && value.minor > unitPriceOf(line, ctx)) {
        return { error: 'السعر الجديد أعلى من سعر الصنف. السعر في السلة يُخفَّض فقط.' };
      }
      return { need: lineNeed(candidate, lines[index]!.priced, ctx, rules) };
    } catch {
      return { error: 'الخصم أكبر من قيمة السطر.' };
    }
  }

  function linePatch(line: Line, value: AdjustValue): Partial<Line> {
    switch (value.mode) {
      case 'qty':
        return { qty: value.qty };
      case 'percent':
        return { adjustment: { kind: 'discount', discount: { type: 'percent', bp: value.bp } } };
      case 'amount':
        return { adjustment: { kind: 'discount', discount: { type: 'amount', minor: value.minor } } };
      case 'price':
        return { adjustment: { kind: 'price', priceMinor: value.minor } };
    }
  }

  function applyLine(line: Line, value: AdjustValue, approval: Approval | null) {
    const patch = linePatch(line, value);
    setCart((c) => updateLine(c, line.lineNo, value.mode === 'qty' ? patch : { ...patch, approval }));
    setMode({ kind: 'items' });
  }

  function checkInvoice(value: AdjustValue): { error: string } | { need: ApprovalNeed | null } {
    const discount =
      value.mode === 'percent'
        ? { type: 'percent' as const, bp: value.bp }
        : { type: 'amount' as const, minor: (value as { minor: number }).minor };
    const candidate: Cart = { ...cart, invoiceDiscount: discount, invoiceApproval: null };
    try {
      return { need: invoiceNeed(candidate, priceCart(candidate, ctx).priced, rules) };
    } catch {
      return { error: 'الخصم أكبر من مجموع الفاتورة.' };
    }
  }

  // ── Prescription (03 › الصيدليات) ──────────────────────────────────────────────────────────
  const rxNeed = useMemo(
    () =>
      prescriptionNeed(
        cart.lines.map((l) => catalog.byVariant.get(l.variantId) ?? {}),
        settings.pharmacy,
      ),
    [cart.lines, catalog.byVariant, settings.pharmacy],
  );
  const hasControlled = cart.lines.some((l) => catalog.byVariant.get(l.variantId)?.controlled);
  /** To payment, through the prescription details when an item asks for them and they are not given yet */
  function startPay() {
    if (hasControlled && !session.permissions.has('pharmacy.controlled')) {
      setNotice({
        tone: 'warning',
        text: 'في الفاتورة دواء مراقَب لا يبيعه إلا الصيدلاني. احذفه أو سلّم الفاتورة له.',
      });
      return;
    }
    const asked = cart.prescription !== undefined;
    if (rxNeed.asks && (!asked || missingPrescription(rxNeed, cart.prescription).length > 0)) {
      setMode({ kind: 'rx' });
      return;
    }
    setMode({ kind: 'pay' });
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────────
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event) => {
    if (props.extraShortcuts?.(event)) return;
    const typing = isTyping(event.target);
    if (event.key === 'Escape' && mode.kind !== 'items' && mode.kind !== 'pay') {
      setMode({ kind: 'items' });
      return;
    }
    if (event.key === 'Escape' && checking) {
      stopChecking();
      return;
    }
    if (keypadOpen || mode.kind === 'pay') return;
    if (event.key === 'F2' || (event.key === '/' && !typing)) {
      event.preventDefault();
      setMode({ kind: 'items' });
      searchRef.current?.focus();
    } else if (event.key === 'F4' || (event.altKey && event.code === 'Digit3')) {
      event.preventDefault();
      if (cart.lines.length > 0) props.onHold();
      else if ((props.heldList?.length ?? props.heldCount) > 0) setMode({ kind: 'heldList' });
    } else if (event.key === 'F9') {
      event.preventDefault();
      if (checking) stopChecking();
      else startChecking();
    } else if (event.key === 'F12' || (event.key === '+' && !typing)) {
      event.preventDefault();
      if (canPay) startPay();
    } else if (event.altKey && event.code === 'Digit1') {
      event.preventDefault();
      if (cart.lines.length > 0) setMode({ kind: 'invoice' });
    } else if ((event.key === '?' || event.key === '؟') && !typing) {
      event.preventDefault();
      setMode({ kind: 'help' });
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────
  const foreign = catalog.rates[0]
    ? catalog.rates[0].unit === ctx.currency
      ? catalog.rates[0].quote
      : catalog.rates[0].unit
    : null;
  const totals = priced?.priced.totals;
  const lineCount = cart.lines.length;
  const wholesaleOn = cart.priceTier === 'wholesale';
  const showWholesale = (session.permissions.has('sale.wholesale') && hasWholesale) || wholesaleOn;
  const canHoldForCustomer = priced !== null && !cart.onlineOrder;
  const ticketTools =
    waitingOnline.length > 0 || canHoldForCustomer || priced !== null || showWholesale || props.heldCount > 0;
  const orderType = cart.service?.orderType ?? defaultOrderType;
  const closeButton = (label: string, onClick: () => void) => (
    <Button
      variant="secondary"
      size="md"
      icon={<CloseIcon size={20} />}
      aria-keyshortcuts="Escape"
      onClick={onClick}
    >
      {label}
      <Kbd>Esc</Kbd>
    </Button>
  );

  const cartPanel = (
    <>
      {/* The ticket's head: what it is, who sells, and the actions on the whole ticket */}
      <header className="flex shrink-0 flex-col gap-3 border-b border-line p-4">
        <div className="flex items-center gap-3">
          <IconChip size="md">
            <CartIcon size={20} />
          </IconChip>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate text-lg/6 font-semibold text-ink">
              {lineCount === 0 ? 'فاتورة جديدة' : 'الفاتورة الحالية'}
            </h2>
            <p className="truncate text-sm text-ink-muted">
              {lineCount === 0
                ? 'لا أسطر بعد'
                : `${counted(lineCount, ['سطر واحد', 'سطران', 'أسطر', 'سطراً'], digits)} · ${counted(pieceCount(cart), ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'], digits)}`}
            </p>
          </div>
          {staff.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2">
              {/* Seen beside the box; the select is named by its own label for screen readers */}
              <span aria-hidden="true" className="text-sm text-ink-subtle">
                البائع
              </span>
              <Select
                label="البائع"
                hideLabel
                value={seller}
                onChange={(e) => {
                  setSeller(e.target.value);
                  void pos.local.set(SELLER_KEY, e.target.value);
                }}
                className="w-36"
              >
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        {ticketTools ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {waitingOnline.length > 0 ? (
              <Button
                variant="secondary"
                size="md"
                icon={<InboxIcon size={20} />}
                aria-label={`طلبات المتجر (${waitingOnline.length})`}
                onClick={() => setMode({ kind: 'online' })}
                className="border-brand/40 bg-brand-soft text-brand-ink"
              >
                طلبات المتجر
                <span
                  aria-hidden="true"
                  className="num grid h-7 min-w-7 place-items-center rounded-full bg-brand px-2 text-sm font-bold text-on-brand shadow-e1"
                >
                  {displayNumber(String(waitingOnline.length), digits)}
                </span>
              </Button>
            ) : null}
            {canHoldForCustomer ? (
              <Button
                variant="ghost"
                size="md"
                icon={<CalendarIcon size={20} />}
                onClick={() => setMode({ kind: 'hold' })}
              >
                احجز
              </Button>
            ) : null}
            {priced ? (
              <Tooltip content="اطبع عرض سعر للزبون">
                <IconButton
                  label="عرض سعر"
                  size="md"
                  icon={<PrintIcon />}
                  onClick={() =>
                    setQuote({
                      settings,
                      lines: priced.lines,
                      totals: priced.priced.totals,
                      at: Date.now(),
                      cashierName: session.fullName,
                      wholesale: cart.priceTier === 'wholesale',
                    })
                  }
                />
              </Tooltip>
            ) : null}
            {showWholesale ? (
              <Button
                variant="ghost"
                size="md"
                aria-pressed={wholesaleOn}
                onClick={() =>
                  setCart((c) => setPriceTier(c, c.priceTier === 'wholesale' ? 'retail' : 'wholesale'))
                }
              >
                سعر الجملة
              </Button>
            ) : null}
            <span className="flex-1" />
            {props.heldCount > 0 ? (
              <button
                type="button"
                aria-label="افتح الفواتير المعلّقة"
                onClick={() => setMode({ kind: 'heldList' })}
                className="min-h-11 rounded-full transition-opacity duration-120 ease-standard hover:opacity-80"
              >
                <Badge tone="warning">
                  {props.heldCount === 1 ? 'فاتورة معلّقة' : `${props.heldCount} فواتير معلّقة`}
                </Badge>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {service ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div
            role="group"
            aria-label="نوع الطلب"
            className="inline-flex gap-1 rounded-control bg-surface-muted p-1"
          >
            {(['dine_in', 'takeaway', 'delivery'] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={orderType === type}
                onClick={() =>
                  setCart((c) => ({
                    ...c,
                    service: {
                      orderType: type,
                      table: type === 'dine_in' ? (c.service?.table ?? null) : null,
                    },
                  }))
                }
                className={cn(
                  'min-h-12 rounded-small px-4 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                  orderType === type
                    ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {ORDER_TYPE_TEXT[type]}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {service.tables.length > 0 ? (
            <Button variant="secondary" size="md" onClick={() => setMode({ kind: 'tables' })}>
              {cart.service?.table ? `طاولة ${cart.service.table}` : 'الطاولات'}
            </Button>
          ) : null}
          {service.kitchenTickets && kitchenLines(cart).length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              icon={<SendIcon size={20} />}
              onClick={() => {
                setKitchen({
                  lines: kitchenLines(cart),
                  orderType: cart.service?.orderType ?? defaultOrderType,
                  table: cart.service?.table ?? null,
                  at: Date.now(),
                  cashierName: session.fullName,
                });
                props.onKitchenSent?.(cart);
                setCart(markSent);
              }}
            >
              للمطبخ
            </Button>
          ) : null}
        </div>
      ) : null}
      {cart.onlineOrder ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <InboxIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            طلب المتجر{' '}
            <bdi dir="ltr" className="num font-semibold">
              {cart.onlineOrder.number}
            </bdi>{' '}
            · {cart.onlineOrder.customerName}: يُغلق عند الدفع
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCart((c) => ({ ...c, onlineOrder: undefined }))}
          >
            افصل الطلب
          </Button>
        </div>
      ) : null}
      {cart.voucher ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <UndoIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            استبدال: القسيمة{' '}
            <bdi dir="ltr" className="num font-semibold">
              {cart.voucher}
            </bdi>{' '}
            تُخصم عند الدفع
          </span>
          <Button size="sm" variant="ghost" onClick={() => setCart((c) => ({ ...c, voucher: undefined }))}>
            ألغِ
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lineCount === 0 ? (
          <div className="h-full p-4">
            <EmptyState
              icon={BarcodeIcon}
              title="السلة فارغة"
              description="امسح الباركود أو اختر صنفاً من الشبكة."
              className="h-full justify-center"
            />
          </div>
        ) : (
          <ul aria-label="أسطر الفاتورة" className="flex flex-col gap-0.5 p-2">
            {cart.lines.map((line, i) => {
              const p = priced?.lines[i];
              const need = needs.get(line.lineNo);
              const adj = line.adjustment;
              const discounted = p !== undefined && p.priced.lineDiscountMinor > 0;
              const percent =
                adj?.kind === 'discount' && adj.discount.type === 'percent' ? adj.discount.bp : null;
              const meta = [
                line.packName ? line.packName : null,
                adj?.kind === 'price' ? 'سعر معدّل' : null,
                // A discount on the line: the price before it struck through, then what was taken off
                discounted && p ? (
                  <span key="was" className="whitespace-nowrap text-ink-subtle">
                    <s>
                      <Money minor={p.priced.grossMinor} currency={ctx.currency} symbol={false} />
                    </s>
                  </span>
                ) : null,
                discounted && p && adj?.kind === 'discount' ? (
                  <span key="d" className="inline-flex items-center gap-1 font-semibold text-info-ink">
                    <PercentIcon size={16} className="shrink-0" aria-hidden="true" />
                    خصم{percent !== null ? ` ${displayNumber(String(percent / 100), digits)}%` : ''}{' '}
                    <Money minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                discounted && p && adj?.kind === 'price' ? (
                  <span key="pd" className="font-semibold text-info-ink">
                    −<Money minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                p && p.priced.lineDiscountMinor > 0 && p.discount?.source === 'promotion' ? (
                  <span key="o" className="font-semibold text-success-ink">
                    {p.discount.reason} −
                    <Money minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                bump === line.lineNo ? (
                  <span key="b" className="font-semibold text-brand-ink motion-safe:animate-pop">
                    +1
                  </span>
                ) : null,
              ].filter(Boolean);
              return (
                <CartLine
                  key={line.lineNo}
                  name={line.name}
                  qtyThousandths={line.qty}
                  unit={line.unitSymbol ?? undefined}
                  unitPriceMinor={p?.unitPriceMinor ?? 0}
                  lineTotalMinor={p?.priced.totalMinor ?? 0}
                  currency={ctx.currency}
                  meta={
                    meta.length > 0 ? (
                      <>
                        {meta.map((m, k) => (
                          <span key={k}>
                            {k > 0 ? ' · ' : ''}
                            {m}
                          </span>
                        ))}
                      </>
                    ) : undefined
                  }
                  extra={
                    line.tracksSerial ? (
                      <button
                        type="button"
                        className={cn(
                          'min-h-11 rounded-small underline-offset-4 hover:underline',
                          (line.serials?.length ?? 0) > 0
                            ? 'text-ink-muted'
                            : 'font-semibold text-danger-ink',
                        )}
                        onClick={() => setMode({ kind: 'serial', lineNo: line.lineNo })}
                      >
                        {line.serials?.length ? `IMEI ${line.serials.join('، ')}` : 'اكتب الرقم التسلسلي'}
                      </button>
                    ) : undefined
                  }
                  selected={selected === line.lineNo}
                  onSelect={() => setSelected((s) => (s === line.lineNo ? null : line.lineNo))}
                >
                  {need ? (
                    <p
                      role="alert"
                      className="flex w-full items-center gap-2 rounded-small bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-ink"
                    >
                      <WarningIcon size={16} className="shrink-0" />
                      {NEED_TEXT[need]}
                    </p>
                  ) : null}
                  <div className="flex w-full items-center gap-2">
                    {line.weighed ? (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={<WeighedIcon size={20} />}
                        onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                      >
                        الوزن
                      </Button>
                    ) : (
                      <div className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1">
                        <button
                          type="button"
                          aria-label="أنقص الكمية"
                          onClick={() => changeQty(line, -1)}
                          className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                        >
                          <RemoveIcon size={20} />
                        </button>
                        <button
                          type="button"
                          aria-label="اكتب الكمية"
                          onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                          className="num min-w-14 border-x border-line px-2 text-center text-lg font-bold text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted"
                        >
                          {formatQuantity(line.qty, digits)}
                        </button>
                        <button
                          type="button"
                          aria-label="زِد الكمية"
                          onClick={() => changeQty(line, 1)}
                          className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                        >
                          <AddIcon size={20} />
                        </button>
                      </div>
                    )}
                    <span className="flex-1" />
                    <IconButton
                      label="احذف السطر"
                      size="md"
                      variant="danger-soft"
                      icon={<DeleteIcon size={20} />}
                      onClick={() => remove(line.lineNo)}
                    />
                  </div>
                  <div className="grid w-full auto-cols-fr grid-flow-col gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<PercentIcon size={20} />}
                      onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'percent' })}
                    >
                      خصم
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<OfferIcon size={20} />}
                      onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'price' })}
                    >
                      السعر
                    </Button>
                    {need ? (
                      <Button
                        variant="secondary"
                        size="md"
                        icon={<KeyIcon size={20} />}
                        onClick={() => setMode({ kind: 'approve', lineNo: line.lineNo, need })}
                      >
                        رمز المدير
                      </Button>
                    ) : null}
                  </div>
                </CartLine>
              );
            })}
          </ul>
        )}
      </div>
      {cart.invoiceDiscount && totals && totals.invoiceDiscountMinor > 0 ? (
        <div
          role="status"
          aria-label="خصم الفاتورة"
          className="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-card border border-info/20 bg-info-soft py-2 ps-3 pe-2 text-sm text-info-ink"
        >
          <PercentIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">
              خصم الفاتورة{' '}
              {cart.invoiceDiscount.type === 'percent'
                ? `${displayNumber(String(cart.invoiceDiscount.bp / 100), digits)}%`
                : ''}{' '}
              <Money minor={totals.invoiceDiscountMinor} currency={ctx.currency} symbol={false} />
            </span>
            <span className="block text-xs text-info-ink/80">يشمل كل الأسطر، وما تضيفه بعد الآن.</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCart((c) => ({ ...c, invoiceDiscount: null, invoiceApproval: null }))}
          >
            أزله
          </Button>
        </div>
      ) : null}
      {removed ? (
        <div
          role="status"
          className="mx-3 mb-3 flex shrink-0 items-center gap-3 rounded-card bg-ink py-1 ps-4 pe-1 text-sm text-surface shadow-e3 motion-safe:animate-rise"
        >
          <span className="min-w-0 flex-1 truncate">حُذف «{removed.line.name}»</span>
          <button
            type="button"
            onClick={() => {
              setCart((c) => restoreLine(c, removed.line, removed.index));
              setRemoved(null);
            }}
            className="flex min-h-12 items-center gap-1.5 rounded-small px-3 font-bold text-brand-soft transition-colors duration-120 ease-standard hover:bg-surface/10"
          >
            <UndoIcon size={16} />
            تراجع
          </button>
        </div>
      ) : null}
      <TotalPanel
        totalMinor={totalMinor}
        currency={ctx.currency}
        label="المطلوب"
        breakdown={[
          ...(totals && totals.discountMinor > 0
            ? [
                { label: 'المجموع قبل الخصم', minor: totals.grossMinor },
                { label: 'الخصم · وفّر الزبون', minor: totals.discountMinor, tone: 'info' as const },
              ]
            : []),
          ...(totals && !settings.taxInclusive && totals.taxMinor > 0
            ? [{ label: 'الضريبة', minor: totals.taxMinor }]
            : []),
        ]}
        note={
          foreign ? (
            <>
              ≈{' '}
              <Money
                minor={convert(totalMinor, ctx.currency, foreign, rateFor(ctx.rates, foreign, ctx.currency))}
                currency={foreign}
              />{' '}
              · سعر الصرف <bdi className="num">{displayNumber(catalog.rates[0]!.rate, digits)}</bdi>
            </>
          ) : undefined
        }
        notice={
          invoiceNeeds ? (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-card border border-warning/20 bg-warning-soft py-2 ps-3 pe-2 text-sm font-semibold text-warning-ink"
            >
              <WarningIcon size={20} className="shrink-0" />
              <span className="min-w-0 flex-1">{NEED_TEXT[invoiceNeeds]}</span>
              <Button
                variant="secondary"
                size="md"
                icon={<KeyIcon size={20} />}
                onClick={() => setMode({ kind: 'approve', lineNo: null, need: invoiceNeeds })}
              >
                رمز المدير
              </Button>
            </div>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              icon={lineCount === 0 && props.heldCount > 0 ? <UndoIcon size={20} /> : <ClockIcon size={20} />}
              aria-keyshortcuts="F4"
              onClick={() => {
                if (lineCount > 0) setMode({ kind: 'holdName' });
                else if (props.heldCount === 1) props.onResume(0);
                else setMode({ kind: 'heldList' });
              }}
              disabled={lineCount === 0 && props.heldCount === 0}
            >
              {lineCount === 0 && props.heldCount > 0 ? 'استرجع المعلّقة' : 'علّق'}
              <Kbd>F4</Kbd>
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<PercentIcon size={20} />}
              aria-keyshortcuts="Alt+1"
              onClick={() => setMode({ kind: 'invoice' })}
              disabled={lineCount === 0}
            >
              خصم
              <Kbd>Alt+1</Kbd>
            </Button>
          </>
        }
        onPay={startPay}
        payDisabled={!canPay}
        payShortcut="F12"
      />
    </>
  );

  return (
    <CashierShell
      statusBar={props.statusBar}
      cart={cartPanel}
      mobileView={phoneView}
      onMobileView={setPhoneView}
      cartBadge={lineCount > 0 ? displayNumber(String(lineCount), digits) : undefined}
    >
      {quote ? <PrintableQuote data={quote} width={80} /> : null}
      {kitchen ? <PrintableKitchenTicket data={kitchen} /> : null}
      {effectiveMode.kind === 'pay' && priced ? (
        <Suspense fallback={null}>
          <PaymentPanel
            cart={cart}
            ctx={ctx}
            totalMinor={totalMinor}
            catalog={catalog}
            shiftId={props.shiftId}
            cashierId={session.userId}
            canCredit={session.permissions.has('sale.credit')}
            staff={staff}
            salespersonId={seller !== session.userId ? seller : null}
            onWholesaleCustomer={() => setCart((c) => setPriceTier(c, 'wholesale'))}
            onBack={() => setMode({ kind: 'items' })}
            onCompleted={(entry) => {
              setMode({ kind: 'items' });
              setSelected(null);
              const order = cart.onlineOrder;
              if (order) {
                const ids = [...soldOnline.filter((id) => id !== order.id).slice(-49), order.id];
                setSoldOnline(ids);
                void pos.local.set(ONLINE_SOLD_KEY, ids);
              }
              props.onSaved(entry);
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'done' ? (
        props.done
      ) : effectiveMode.kind === 'line' && lineOf(effectiveMode.lineNo) ? (
        (() => {
          const line = lineOf(effectiveMode.lineNo)!;
          const modes: AdjustMode[] =
            effectiveMode.adjust === 'qty' ? ['qty'] : ['percent', 'amount', 'price'];
          return (
            <AdjustPanel
              key={`${line.lineNo}:${effectiveMode.adjust}`}
              title={
                effectiveMode.adjust === 'qty'
                  ? line.weighed
                    ? 'الوزن'
                    : 'الكمية'
                  : effectiveMode.adjust === 'price'
                    ? 'سعر جديد في السلة'
                    : 'خصم على السطر'
              }
              subtitle={line.name}
              modes={modes}
              initialMode={effectiveMode.adjust}
              currency={ctx.currency}
              fractions={line.weighed}
              staff={staff}
              check={(value) => checkLine(line, value)}
              onApply={(value, approval) => applyLine(line, value, approval)}
              onRemove={
                line.adjustment
                  ? () => {
                      setCart((c) => updateLine(c, line.lineNo, { adjustment: null, approval: null }));
                      setMode({ kind: 'items' });
                    }
                  : undefined
              }
              onClose={() => setMode({ kind: 'items' })}
              preview={() => (
                <span>
                  سعر الرف للواحدة{' '}
                  <Money
                    minor={unitPriceOf(line, ctx)}
                    currency={ctx.currency}
                    className="font-semibold text-ink"
                  />
                  {' · '}السطر{' '}
                  <Money
                    minor={lineGross(unitPriceOf(line, ctx), line.qty)}
                    currency={ctx.currency}
                    className="font-semibold text-ink"
                  />
                </span>
              )}
            />
          );
        })()
      ) : effectiveMode.kind === 'invoice' ? (
        <AdjustPanel
          title="خصم على الفاتورة"
          subtitle={`يشمل كل أسطر الفاتورة (${displayNumber(String(lineCount), digits)}) وما تضيفه بعدها`}
          modes={['percent', 'amount']}
          initialMode="percent"
          currency={ctx.currency}
          staff={staff}
          check={checkInvoice}
          onApply={(value, approval) => {
            setCart((c) => ({
              ...c,
              invoiceDiscount:
                value.mode === 'percent'
                  ? { type: 'percent', bp: value.bp }
                  : { type: 'amount', minor: (value as { minor: number }).minor },
              invoiceApproval: approval,
            }));
            setMode({ kind: 'items' });
          }}
          onRemove={
            cart.invoiceDiscount
              ? () => {
                  setCart((c) => ({ ...c, invoiceDiscount: null, invoiceApproval: null }));
                  setMode({ kind: 'items' });
                }
              : undefined
          }
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'approve' ? (
        <SalePanel title="موافقة على الخصم" icon={<KeyIcon size={20} />}>
          <ManagerCode
            staff={staff}
            permission="sale.discount_over_limit"
            reason={NEED_TEXT[effectiveMode.need]}
            onApproved={(approval) => {
              const { lineNo } = effectiveMode;
              setCart((c) =>
                lineNo === null ? { ...c, invoiceApproval: approval } : updateLine(c, lineNo, { approval }),
              );
              setMode({ kind: 'items' });
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />
        </SalePanel>
      ) : effectiveMode.kind === 'rx' ? (
        <PrescriptionPanel
          need={rxNeed}
          initial={cart.prescription}
          controlled={hasControlled}
          onSave={(prescription) => {
            setCart((c) => ({ ...c, prescription }));
            setMode({ kind: 'pay' });
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'serial' && lineOf(effectiveMode.lineNo) ? (
        <SerialPanel
          key={effectiveMode.lineNo}
          line={lineOf(effectiveMode.lineNo)!}
          taken={
            new Set(
              cart.lines.filter((l) => l.lineNo !== effectiveMode.lineNo).flatMap((l) => l.serials ?? []),
            )
          }
          onSave={(serials) => {
            setCart((c) => updateLine(c, effectiveMode.lineNo, { serials }));
            setMode({ kind: 'items' });
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'pick' && pieces.get(effectiveMode.productId) ? (
        <VariantPicker
          key={effectiveMode.productId}
          name={pieces.get(effectiveMode.productId)![0]!.productName ?? ''}
          pieces={pieces.get(effectiveMode.productId)!}
          inCart={inCartQty}
          onAdd={(piece) => {
            setMode({ kind: 'items' });
            add(piece);
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'choose' ? (
        <ModifierPanel
          key={effectiveMode.item.variantId}
          item={effectiveMode.item}
          onAdd={(choice) => {
            const { item, hit } = effectiveMode;
            setMode({ kind: 'items' });
            add(item, hit, undefined, choice);
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'hold' && priced ? (
        <HoldPanel
          cart={cart}
          totalMinor={totalMinor}
          currency={ctx.currency}
          shiftId={props.shiftId}
          cashierId={session.userId}
          timezone={settings.timezone}
          cutoff={settings.businessDayCutoff}
          onPrintDeposit={props.onPrintDeposit}
          onClose={() => setMode({ kind: 'items' })}
          onDone={(hold) => {
            setCart(() => EMPTY_CART);
            setSelected(null);
            setMode({ kind: 'items' });
            setNotice({
              tone: 'info',
              text: hold.depositCode
                ? `حُجز ${hold.number}. العربون بالقسيمة ${hold.depositCode} ويُخصم عند الاستلام.`
                : `حُجز ${hold.number}. يجده الكاشير في «طلبات المتجر» عند الاستلام.`,
            });
          }}
        />
      ) : effectiveMode.kind === 'holdName' && priced ? (
        <HoldNamePanel
          initial={cart.customer?.name ?? cart.onlineOrder?.customerName ?? ''}
          onHold={(name) => {
            setMode({ kind: 'items' });
            setSelected(null);
            props.onHold(name);
          }}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'heldList' ? (
        <HeldList
          carts={props.heldList ?? []}
          currency={ctx.currency}
          totalOf={(c) => {
            try {
              return c.lines.length > 0 ? priceCart(c, ctx).priced.totals.totalMinor : 0;
            } catch {
              return 0;
            }
          }}
          currentHasLines={cart.lines.length > 0}
          onPick={(index) => {
            setMode({ kind: 'items' });
            setSelected(null);
            props.onResume(index);
          }}
          onDiscard={(index) => props.onDiscardHeld?.(index)}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'online' ? (
        <OnlineOrdersPanel
          orders={waitingOnline}
          onClose={() => setMode({ kind: 'items' })}
          onOpen={(order) => {
            if (cart.lines.length > 0) {
              setNotice({ tone: 'warning', text: 'أنهِ الفاتورة الحالية أو علّقها، ثم افتح الطلب.' });
              setMode({ kind: 'items' });
              return;
            }
            const { cart: opened, missing } = orderCart(order, catalog);
            setCart(() => opened);
            setMode({ kind: 'items' });
            if (props.done) props.onNextSale();
            setNotice(
              missing.length > 0
                ? { tone: 'warning', text: `غير موجود على هذا الجهاز: ${missing.join('، ')}. أضفه يدوياً.` }
                : { tone: 'info', text: `فُتح طلب المتجر ${order.number} للزبون ${order.customerName}.` },
            );
          }}
        />
      ) : effectiveMode.kind === 'tables' && service ? (
        <TableBoard
          tables={service.tables}
          held={props.heldCarts ?? []}
          current={cart}
          currency={ctx.currency}
          totalOf={(c) => {
            try {
              return c.lines.length > 0 ? priceCart(c, ctx).priced.totals.totalMinor : 0;
            } catch {
              return 0;
            }
          }}
          onPick={(table) => {
            setMode({ kind: 'items' });
            props.onOpenTable?.(table);
          }}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'help' ? (
        <SalePanel title="دليل الاختصارات" actions={closeButton('أغلق', () => setMode({ kind: 'items' }))}>
          <ul className="flex flex-col divide-y divide-line">
            {SHORTCUTS.map(([action, key]) => (
              <li key={action} className="flex min-h-12 items-center justify-between gap-4 py-2">
                <span className="text-ink">{action}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-sm text-ink-subtle">
                  {key.split(' ').map((part, index) =>
                    part === 'أو' || part === 'ثم' ? (
                      <span key={index}>{part}</span>
                    ) : (
                      <Kbd key={index} always>
                        {part}
                      </Kbd>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SalePanel>
      ) : (
        <ItemsArea
          catalog={catalog}
          pieces={pieces}
          searchRef={searchRef}
          inCart={inCart}
          pickingProduct={effectiveMode.kind === 'pick' ? effectiveMode.productId : null}
          multiplier={multiplier}
          notice={notice}
          onDismissNotice={dismissNotice}
          hasLastLines={props.lastLines.length > 0}
          onRepeatLast={repeatLast}
          onPickItem={pickItem}
          onPickModel={pickModel}
          onScanCode={scanCode}
          onMultiplier={setMultiplier}
          checking={checking}
          check={check}
          onStopChecking={stopChecking}
          onStartChecking={startChecking}
        />
      )}
    </CashierShell>
  );
}
