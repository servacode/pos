import { createPortal } from 'react-dom';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { lazyChunk, TillBoundary } from '../chunks';
import { dayText } from '../../lib/dates';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import { holdExpiryDaysOf } from '@serva/core/contracts/till';
import { businessDateOf, packPrice, rateFor } from '@serva/core/sale';
import { promotionActive, type PromotionAudience } from '@serva/core/promotions';
import { parseScaleBarcode, qtyForPrice } from '@serva/core/scale';
import {
  allocateFefo,
  missingPrescription,
  pickBatch,
  prescriptionNeed,
  usesAutoBatch,
} from '@serva/core/pharmacy';
import type { OutboxEntry } from '@serva/sync';
import {
  AddIcon,
  Badge,
  BarcodeIcon,
  Button,
  CalendarIcon,
  CheckIcon,
  CartIcon,
  CartLine,
  CashierShell,
  Dialog,
  ClockIcon,
  CloseIcon,
  cn,
  DeleteIcon,
  displayNumber,
  formatQuantity,
  IconChip,
  InboxIcon,
  KeyIcon,
  Menu,
  MenuItem,
  MoreIcon,
  Money,
  OfferIcon,
  PercentIcon,
  PrintIcon,
  RemoveIcon,
  SearchIcon,
  SendIcon,
  TotalPanel,
  UndoIcon,
  useDigits,
  WarningIcon,
  WeighedIcon,
} from '@serva/ui';
import { barcodeKey, type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { ExactMoney } from '../ExactMoney';
import { useRep } from '../../rep/state';
import { counted, isolateSizes } from '../format';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { CartWarnings } from './CartWarnings';
import { BatchBanner } from './BatchBanner';
import { QuoteDialog, type QuoteChoice } from './QuoteDialog';
import { batchGuard, blockText, planBatches } from './batches';
import { reservedForOthers } from './reserved';
import { showsWaste } from './waste';
import { deviceDocuments } from '../shift/shift';
import { bestSellers } from './bestSellers';
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
  applyContractPrices,
  contractSavingMinor,
  buyGetHint,
  customerPriceKind,
  shelfPriceOf,
  type ItemChoice,
  EMPTY_CART,
  couponPromotion,
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
import { scanBeep } from '../beep';
import { usePos } from '../services';
import { fetchContractPrices } from '../rentals/api';
import { PrintableQuote, type QuoteData } from '../receipt/Quote';
import { quotationInputOf, saveQuotation } from '../quotations/api';
import { ORDER_TYPE_TEXT, PrintableKitchenTicket, type KitchenData } from '../receipt/KitchenTicket';
import { ModifierPanel } from './ModifierPanel';
import { changeLabel, modelPieces, optionsOf, orderPieces, pieceFor, variantSplit } from './models';
import { UnitPanel } from './UnitPanel';
import { VariantPicker } from './VariantPicker';
import { TableBoard } from './TableBoard';
import { CancelSentLine } from '../hall/CancelSentLine';
import { SplitBill } from '../hall/SplitBill';
import { cartFromOrder } from '../hall/hallCart';
import type { HallTools } from '../hall/tools';
import type { SavedGiftVoucher } from '../customers/GiftVoucherScreen';
import { HoldPanel } from './HoldPanel';
import { HeldList, HoldNamePanel } from './HeldList';
import { dollarNote, ItemsArea, type PriceCheck } from './ItemsArea';
import { armClickGuard } from './clickGuard';
import { isUnfedService } from './serviceFee';
import { placeholderIconFor } from '../../lib/productPlaceholder';
import { OnlineOrdersPanel } from './OnlineOrdersPanel';
import { ONLINE_SOLD_KEY, orderCart, waitingOrders } from './onlineOrders';
import { SerialPanel } from './SerialPanel';
import { serialLabel } from '@serva/core/contracts/warranty';
import { PrescriptionPanel } from './PrescriptionPanel';
import { flushShortages } from './shortages';
import { Kbd } from './Kbd';
import { SalePanel } from './SalePanel';
import { packLineText, pieceWord } from './packText';

// «تالف / هدر» needs the server and is rarely opened: its own chunk keeps the cashier's size down
// «أضف صنف جديد» and «بدائل متوفرة» (a pharmacy only) are rarely opened: their own chunks too
const NewProductPanel = lazyChunk(() =>
  import('./NewProductPanel').then((m) => ({ default: m.NewProductPanel })),
);
const AlternativesPanel = lazyChunk(() =>
  import('./AlternativesPanel').then((m) => ({ default: m.AlternativesPanel })),
);
const WastePanel = lazyChunk(() => import('./WastePanel').then((m) => ({ default: m.WastePanel })));
const PaymentPanel = lazyChunk(() =>
  import('../pay/PaymentPanel').then((m) => ({ default: m.PaymentPanel })),
);

export type SaleMode =
  | { kind: 'items' }
  | { kind: 'line'; lineNo: number; adjust: AdjustMode }
  | { kind: 'fee'; item: CatalogItem; hit: BarcodeHit | null }
  | { kind: 'invoice' }
  | { kind: 'approve'; lineNo: number | null; need: ApprovalNeed }
  | { kind: 'batchApprove' }
  | {
      kind: 'alternatives';
      variantId: string;
      /** The blocked line a pick replaces (round 39) */ lineNo?: number;
    }
  | { kind: 'pay' }
  | { kind: 'done' }
  | { kind: 'help' }
  | { kind: 'choose'; item: CatalogItem; hit: BarcodeHit | null }
  | { kind: 'tables' }
  | { kind: 'split' }
  | { kind: 'cancelSent'; lineNo: number }
  | { kind: 'online' }
  | { kind: 'hold' }
  | { kind: 'newProduct'; barcode: string }
  | { kind: 'waste' }
  | { kind: 'holdName' }
  | { kind: 'heldList' }
  | { kind: 'check' }
  | { kind: 'serial'; lineNo: number }
  | { kind: 'rx' }
  | {
      kind: 'pick';
      productId: string;
      /** A size chip was tapped (or a line is being changed): the picker opens with this chosen */
      initial?: Record<string, string>;
      /** A line already in the cart whose size or colour is being changed: the new piece takes its place */
      replaceLine?: number;
    }
  | {
      kind: 'unit';
      variantId: string;
      /** A line already in the cart whose unit is being changed */ replaceLine?: number;
    };

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
  onHold: (name?: string, sellerId?: string) => void;
  /** Brings a held cart back (the last one when none is named) */
  onResume: (index?: number) => void;
  onDiscardHeld?: (index: number) => void;
  /** The held orders, for the table board */
  heldCarts?: readonly Cart[];
  /** Opens a table's order, or starts one there (CashierApp keeps the held orders) */
  onOpenTable?: (table: string) => void;
  /** The order just sent to the kitchen, before it is marked sent (online, the server gets it too) */
  onKitchenSent?: (cart: Cart) => void;
  /** The table's order on the server and what the till does with it: split the bill, move, cancel after the kitchen */
  hallTools?: HallTools;
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
/** The unit last used for each item (the piece or a box), so the unit sheet offers it first */
const LAST_UNIT_KEY = 'serva.lastUnit';
/** The pay screen was open: a reload of the till brings it back for the same cashier and total */
const PAY_OPEN_KEY = 'pay-open';
/** «علّق» and «خصم» beside the pay button: an icon over a small word, 72 high like the button */
const CART_QUICK =
  'flex min-h-18 w-16 flex-col items-center justify-center gap-1 rounded-card border border-line-control/50 bg-surface text-xs font-semibold text-ink shadow-e1 transition-colors duration-120 ease-standard hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50';

/** «قطعة» or «علبة (100 قطعة)»: the unit said on the added toast */
function unitName(hit: BarcodeHit | null): string {
  if (!hit) return 'قطعة';
  const qty = hit.barcode.packQty / 1000;
  return `${hit.barcode.packName ?? 'علبة'} (${qty} ${pieceWord(hit.barcode.packQty)})`;
}

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
    const running = catalog.promotions.filter((p) => promotionActive(p, now, settings.timezone));
    // A shop order's coupon: the offer its code opened applies to this sale, as the order was placed
    return cart.onlineOrder?.couponRule
      ? [...running, couponPromotion(cart.onlineOrder.couponRule)]
      : running;
  }, [catalog.promotions, settings.timezone, cart]);
  // 03 › الصيدليات: what the cart takes from which batch (first expiry first), and from the shelf.
  // What this till sold and has not sent yet comes off what it last pulled, as it works offline.
  const posServices = usePos();
  // A pharmacy's shortage requests kept while the till was offline go to the server once it can reach it (round 38)
  useEffect(() => {
    void flushShortages(posServices);
  }, [posServices]);
  // Online orders this till sold, until the next pull says they are done
  const [soldOnline, setSoldOnline] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void posServices.local.get<string[]>(ONLINE_SOLD_KEY).then((ids) => {
      if (alive && ids) setSoldOnline(ids);
    });
    return () => {
      alive = false;
    };
  }, [posServices.local]);
  // Decision 14: what customers' holds and the carts put aside keep back, so the same piece is not sold twice
  const reservedNow = useMemo(
    () =>
      reservedForOthers({
        orders: catalog.onlineOrders,
        soldOnline,
        held: props.heldList ?? [],
        cart,
        branchId: catalog.staff.branches.find((b) => b.code === posServices.device.branchCode)?.id ?? null,
        till: settings.till,
        now: Date.now(),
      }),
    [
      catalog.onlineOrders,
      catalog.staff.branches,
      soldOnline,
      props.heldList,
      cart,
      posServices.device.branchCode,
      settings.till,
    ],
  );
  // The tiles read the reserved map: keep the same object while its content is the same, so a cart edit does not redraw the grid
  const reservedStable = useRef(reservedNow);
  if (
    reservedStable.current !== reservedNow &&
    (reservedStable.current.size !== reservedNow.size ||
      [...reservedNow].some(([id, qty]) => reservedStable.current.get(id) !== qty))
  )
    reservedStable.current = reservedNow;
  const [unsent, setUnsent] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(posServices.store).then((list) => alive && setUnsent(list));
    return () => {
      alive = false;
    };
  }, [posServices.store, props.done]);
  const batchPlan = useMemo(
    () =>
      planBatches({
        cart,
        // The plan takes the unsent sales off the pulled stock itself: it must not see the tiles' lowered one
        catalog: catalog.original ?? catalog,
        today: businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff),
        pending: unsent,
        pharmacy: settings.pharmacy,
        reserved: reservedNow,
      }),
    [cart, catalog, unsent, settings.timezone, settings.businessDayCutoff, settings.pharmacy, reservedNow],
  );
  // The manager's code allowed an expired batch to be sold (the store's «بيع المنتهي برمز المدير»): the lines then
  // take from it, last, and say so on the document (round 38). Approval and warnings still follow the plan above.
  const expiredAllowed =
    settings.pharmacy?.allowExpiredWithCode === true &&
    batchPlan.uncovered.some((i) => i.expiredQty > 0) &&
    cart.batchApproval?.sig === batchPlan.signature;
  const takePlan = useMemo(
    () =>
      expiredAllowed
        ? planBatches({
            cart,
            catalog: catalog.original ?? catalog,
            today: businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff),
            pending: unsent,
            pharmacy: settings.pharmacy,
            reserved: reservedNow,
            allowExpired: true,
          })
        : batchPlan,
    [
      expiredAllowed,
      batchPlan,
      cart,
      catalog,
      unsent,
      settings.timezone,
      settings.businessDayCutoff,
      settings.pharmacy,
      reservedNow,
    ],
  );
  const guard = useMemo(
    () => batchGuard(batchPlan, settings.pharmacy, settings.till?.blockNegativeStock === true),
    [batchPlan, settings.pharmacy, settings.till],
  );
  const batchApproved = cart.batchApproval?.sig === batchPlan.signature;
  const batchWaits = guard.approvals.length > 0 && !batchApproved;
  // Who the sale is for, so a promotion meant for wholesale customers, one kind of shop or the reps'
  // phones reaches only them
  const repState = useRep();
  const audience = useMemo<PromotionAudience>(() => {
    const known = cart.customer ? catalog.customers.find((c) => c.id === cart.customer!.id) : undefined;
    return {
      customerKind: known?.kind ?? null,
      priceTier: cart.priceTier ?? known?.priceTier ?? 'retail',
      rep: repState !== null,
    };
  }, [cart.customer, cart.priceTier, catalog.customers, repState]);
  const ctx = useMemo<PricingContext>(
    () => ({
      currency: settings.baseCurrency,
      taxInclusive: settings.taxInclusive,
      rates: catalog.rates,
      promotions: activePromotions,
      audience,
      variants: catalog.byVariant,
      batchPlan: takePlan.allocations,
    }),
    [
      settings.baseCurrency,
      settings.taxInclusive,
      catalog.rates,
      activePromotions,
      audience,
      catalog.byVariant,
      takePlan.allocations,
    ],
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
  const [notice, setNotice] = useState<{
    tone: 'warning' | 'info';
    text: string;
    href?: string;
    linkText?: string;
    /** A button instead of a link: runs here on the till (decision 15: «أضف صنف جديد») */
    actionText?: string;
    onAction?: () => void;
  } | null>(null);
  const [removed, setRemoved] = useState<{ line: Line; index: number } | null>(null);
  const [bump, setBump] = useState<number | null>(null);
  // «أُضيف ✓»: a picker closes the moment its last choice adds the piece, so the add is said out loud for a moment
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(null), 1600);
    return () => clearTimeout(timer);
  }, [justAdded]);
  // «بُدّل ✓»: a line's size or colour swapped from the cart, said in its own words (the cart stays open)
  const [justSwapped, setJustSwapped] = useState<string | null>(null);
  useEffect(() => {
    if (!justSwapped) return;
    const timer = setTimeout(() => setJustSwapped(null), 1600);
    return () => clearTimeout(timer);
  }, [justSwapped]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  /** «عرض سعر»: asks a few optional details first, then saves a numbered quotation (and prints it if asked) */
  const [quoteAsk, setQuoteAsk] = useState<PricedCart | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  async function saveQuote(from: PricedCart, choice: QuoteChoice) {
    const slip: QuoteData = {
      settings,
      lines: from.lines,
      totals: from.priced.totals,
      at: Date.now(),
      cashierName: session.fullName,
      wholesale: cart.priceTier === 'wholesale',
    };
    const token = posServices.device.token;
    setQuoteBusy(true);
    try {
      if (token && posServices.online()) {
        const saved = await saveQuotation(
          quotationInputOf(from.lines, cart.invoiceDiscount, cart.customer ?? null, choice.customerName, {
            status: choice.print ? 'sent' : 'draft',
            validUntil: businessDateOf(
              Date.now() + choice.validDays * 86_400_000,
              settings.timezone,
              settings.businessDayCutoff,
            ),
            notes: choice.notes,
          }),
          token,
          posServices.fetch,
        );
        if (saved.kind === 'ok') {
          setQuoteAsk(null);
          if (choice.print)
            setQuote({ ...slip, number: saved.body.number, validUntil: saved.body.validUntil });
          else
            setNotice({
              tone: 'info',
              text: `حُفظ عرض السعر ${saved.body.number} كمسوّدة. تجده في «العروض».`,
            });
          return;
        }
      }
      setQuoteAsk(null);
      // No server to number it: the slip still prints, marked as not saved
      if (choice.print) setQuote({ ...slip, unsaved: true });
      else
        setNotice({
          tone: 'warning',
          text: 'لا إنترنت الآن، فلم يُحفظ عرض السعر. اطبعه أو أعد المحاولة لاحقاً.',
        });
    } finally {
      setQuoteBusy(false);
    }
  }
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
  // «الأكثر بيعاً»: the products this device sold most lately, for the strip at the top of the grid
  const [best, setBest] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then(
      (list) => alive && setBest(bestSellers(catalog, list)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pos.store, catalog]);
  const [seller, setSeller] = useState<string>(session.userId);
  useEffect(() => {
    let alive = true;
    // Kept only for the sale in progress of the same cashier: never carried to the next sale or shift
    void pos.local.get<string | { by: string; id: string }>(SELLER_KEY).then((saved) => {
      if (!alive || !saved || typeof saved === 'string') return;
      if (saved.by === session.userId && staff.some((m) => m.id === saved.id)) setSeller(saved.id);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, staff, session.userId]);
  const [lastUnits, setLastUnits] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void pos.local.get<Record<string, string>>(LAST_UNIT_KEY).then((saved) => {
      if (alive && saved && typeof saved === 'object') setLastUnits(saved);
    });
    return () => {
      alive = false;
    };
  }, [pos.local]);
  // The sale put on hold keeps its seller with it: the new empty cart starts with the cashier again
  const holdSale = (name?: string) => {
    // A service with no fee is not a sale yet: it is never held
    if (cart.lines.some((l) => isUnfedService(l, catalog.byVariant))) {
      setNotice({ tone: 'warning', text: 'حدّد أجرة الخدمة أولاً، أو احذف سطرها، ثم علّق الفاتورة.' });
      return;
    }
    // Every held cart keeps its seller (the cashier when none was picked), so the list always says who
    const heldSeller = seller;
    setSeller(session.userId);
    void pos.local.remove(SELLER_KEY);
    props.onHold(name, heldSeller);
  };
  // A held cart brought back restores the seller it was held with
  const cartSeller = cart.sellerId;
  useEffect(() => {
    if (!cartSeller) return;
    if (!staff.some((m) => m.id === cartSeller)) return;
    setSeller(cartSeller);
    void pos.local.set(SELLER_KEY, { by: session.userId, id: cartSeller });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSeller]);
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
  // The instalment fee of the plan being made on the pay screen: shown with the total in the cart panel
  const [planFeeMinor, setPlanFeeMinor] = useState(0);
  // A reload in the middle of paying brings the pay screen back (with the instalment plan, which the
  // pay screen restores itself) for the same cashier, cart size and total
  const payKey = useRef<{ userId: string; lines: number; total: number } | null | undefined>(undefined);
  const [payKeyLoaded, setPayKeyLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    pos.local
      .get<{ userId: string; lines: number; total: number }>(PAY_OPEN_KEY)
      .then((saved) => {
        if (!alive) return;
        payKey.current = saved ?? null;
        setPayKeyLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pos.local]);
  useEffect(() => {
    const saved = payKey.current;
    if (!payKeyLoaded || !saved || !priced || cart.lines.length === 0) return;
    payKey.current = null;
    if (saved.userId === session.userId && saved.lines === cart.lines.length && saved.total === totalMinor) {
      setMode({ kind: 'pay' });
    } else {
      pos.local.remove(PAY_OPEN_KEY).catch(() => undefined);
    }
  }, [payKeyLoaded, priced, cart.lines.length, totalMinor, session.userId, pos.local]);
  useEffect(() => {
    // Before the saved flag is read (or while it waits for the cart), leave it alone
    if (!payKeyLoaded || payKey.current) return;
    if (mode.kind === 'pay' && cart.lines.length > 0) {
      pos.local
        .set(PAY_OPEN_KEY, { userId: session.userId, lines: cart.lines.length, total: totalMinor })
        .catch(() => undefined);
    } else {
      pos.local.remove(PAY_OPEN_KEY).catch(() => undefined);
    }
  }, [payKeyLoaded, mode.kind, cart.lines.length, totalMinor, session.userId, pos.local]);
  const contractSaved = cart.lines.reduce((sum, l) => sum + contractSavingMinor(l, ctx), 0);
  const unnumbered = missingSerials(cart);
  const blocked =
    needs.size > 0 ||
    invoiceNeeds !== null ||
    unnumbered.length > 0 ||
    cart.lines.some((l) => isUnfedService(l, catalog.byVariant)) ||
    guard.blocks.length > 0 ||
    guard.stockBlocks.length > 0 ||
    batchWaits;
  const canPay = cart.lines.length > 0 && priced !== null && !blocked;

  const showDone = props.done !== null && cart.lines.length === 0;
  const effectiveMode: SaleMode = showDone && mode.kind === 'items' ? { kind: 'done' } : mode;

  // ── Adding items ────────────────────────────────────────────────────────────────────────────
  // An item priced at zero is confirmed before it goes into the cart: «السعر 0 — تأكيد؟»
  const [zeroAsk, setZeroAsk] = useState<{
    item: CatalogItem;
    hit: BarcodeHit | null;
    weighedQty: number | undefined;
    choice: ItemChoice | undefined;
  } | null>(null);
  const zeroOk = useRef(false);
  // A simple item with nothing left is added after a confirm tap, like an out-of-stock size
  const [outAsk, setOutAsk] = useState<{
    item: CatalogItem;
    hit: BarcodeHit | null;
    weighedQty: number | undefined;
    choice: ItemChoice | undefined;
  } | null>(null);
  const outOk = useRef(false);
  // A product just made at the till (round 39): it joins the cart once the catalog holds it
  const [justMade, setJustMade] = useState<{ variantId: string; name: string; offline: boolean } | null>(
    null,
  );
  // A question is open (no stock, price 0): «أُضيف ✓» must not sit behind it before the cashier has decided
  const asking = outAsk !== null || zeroAsk !== null;
  useEffect(() => {
    if (asking) setJustAdded(null);
  }, [asking]);
  const add = useCallback(
    (
      item: CatalogItem,
      hit?: BarcodeHit | null,
      weighedQty?: number,
      choice?: ItemChoice,
      feeMinor?: number,
    ) => {
      // A service with no fixed fee: the fee pad opens first and NO line exists until the fee is confirmed
      if (item.isService && item.price.priceMinor === 0 && feeMinor === undefined) {
        setMode({ kind: 'fee', item, hit: hit ?? null });
        return;
      }
      if (
        item.price.priceMinor === 0 &&
        !item.isService &&
        !zeroOk.current &&
        !cartRef.current.lines.some((l) => l.variantId === item.variantId)
      ) {
        setZeroAsk({ item, hit: hit ?? null, weighedQty, choice });
        return;
      }
      // A piece sold by its serial number: a second tap never piles up lines of numbers not given yet,
      // nor of pieces beyond what the store holds (it asks, like an item with nothing left)
      if (item.tracksSerial && feeMinor === undefined && !outOk.current) {
        const mine = cartRef.current.lines.filter((l) => l.variantId === item.variantId);
        const pieces = (l: Line) => Math.round((l.qty * l.packQty) / 1_000_000);
        const waiting = mine.find((l) => (l.serials?.length ?? 0) < pieces(l));
        if (waiting) {
          setSelected(waiting.lineNo);
          setMode({ kind: 'serial', lineNo: waiting.lineNo });
          return;
        }
        if (
          mine.length > 0 &&
          typeof item.stockQty === 'number' &&
          mine.reduce((sum, l) => sum + pieces(l), 0) * 1000 >= item.stockQty
        ) {
          setOutAsk({ item, hit: hit ?? null, weighedQty, choice });
          return;
        }
      }
      if (
        !item.isService &&
        feeMinor === undefined &&
        typeof item.stockQty === 'number' &&
        item.stockQty <= 0 &&
        !outOk.current &&
        !cartRef.current.lines.some((l) => l.variantId === item.variantId)
      ) {
        setOutAsk({ item, hit: hit ?? null, weighedQty, choice });
        return;
      }
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
      // A branch that has its batches' balances (stock_levels.batches) plans them for the whole cart
      // at payment (batches.ts); one that has only the dates (an older pull) picks here as before.
      const planned = usesAutoBatch(settings.pharmacy) && Array.isArray(item.stockBatches);
      const pick = planned
        ? { kind: 'ok' as const, batch: allocateFefo(item.stockBatches!, 1, today).allocations[0] }
        : usesAutoBatch(settings.pharmacy)
          ? pickBatch(item.shelfBatches, today)
          : { kind: 'none' as const };
      if (pick.kind === 'expired') {
        setNotice({
          tone: 'warning',
          text: `لا يُباع «${item.name}»: كل دفعاته على الرف منتهية الصلاحية (آخرها ${pick.latest}).`,
        });
        return;
      }
      const shown = pick.kind === 'ok' && pick.batch ? pick.batch : null;
      const batch = planned ? null : (shown as { batchNo: string | null; expiry: string } | null);
      const qty = weighedQty ?? (multiplier ?? 1) * 1000;
      setMultiplier(null);
      setNotice(null);
      if (props.done) props.onNextSale();
      // From the latest cart, so scans arriving before the next render all count.
      const current = cartRef.current;
      let next: Cart;
      let added: number | null;
      if (feeMinor !== undefined) {
        // Confirmed fee: a line of its own at that fee (the same fee again just adds one more)
        const sameFee = current.lines.find(
          (l) => l.variantId === item.variantId && l.priceMinor === feeMinor && l.adjustment === null,
        );
        if (sameFee) {
          next = updateLine(current, sameFee.lineNo, { qty: sameFee.qty + qty });
          added = sameFee.lineNo;
        } else {
          const fresh = addItem({ ...current, lines: [] }, item, hit, qty, choice ?? null, batch);
          const line = {
            ...fresh.lines[0]!,
            priceMinor: feeMinor,
            priceCurrency: ctx.currency,
            adjustment: null,
            priceTyped: true,
          };
          next = { ...current, nextLineNo: fresh.nextLineNo, lines: [...current.lines, line] };
          added = line.lineNo;
        }
      } else {
        next = addItem(current, item, hit, qty, choice ?? null, batch);
        added = next.lines.find((l, i) => l !== current.lines[i])?.lineNo ?? null;
      }
      cartRef.current = next;
      setCart(() => next);
      setBump(added);
      // 03 › الصيدليات: what is on the shelf may have expired, or soon will
      const expiry = shown ? shown.expiry : planned ? null : item.nearestExpiry;
      if (expiry) {
        const soon = businessDateOf(
          Date.now() + 30 * 86_400_000,
          settings.timezone,
          settings.businessDayCutoff,
        );
        if (expiry < today) {
          setNotice({
            tone: 'warning',
            text: `صلاحية «${item.name}» انتهت في ${dayText(expiry, digits)} حسب آخر استلام. تأكد من العلبة قبل البيع.`,
          });
        } else if (expiry <= soon) {
          // Near its end: it goes first, whatever else is on the shelf (nearest expiry first)
          setNotice({
            tone: 'warning',
            text: shown?.batchNo
              ? `صلاحية «${item.name}» (دفعة ${shown.batchNo}) تنتهي في ${dayText(expiry, digits)}. أقرب انتهاء أولاً: تأكد من العلبة قبل البيع.`
              : `صلاحية «${item.name}» تنتهي في ${dayText(expiry, digits)}. أقرب انتهاء أولاً: تأكد من العلبة قبل البيع.`,
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
      digits,
    ],
  );

  useEffect(() => {
    if (!justMade) return;
    const item = catalog.byVariant.get(justMade.variantId);
    if (!item) return;
    setJustMade(null);
    // The cashier made it to sell it: no «لا يوجد مخزون» question for a product that has no stock yet
    outOk.current = true;
    try {
      add(item, null);
    } finally {
      outOk.current = false;
    }
    setNotice({
      tone: 'info',
      text: `أُضيف «${justMade.name}» وصار في السلة.${justMade.offline ? ' يصل إلى المتجر عند عودة الاتصال.' : ' يراجعه المالك لاحقاً.'}`,
    });
  }, [justMade, catalog, add]);

  const scan = useCallback(
    (raw: string) => {
      const code = barcodeKey(raw);
      const hit = catalog.byBarcode.get(code);
      // «سعر صنف»: a scan shows the item's price and stock, and adds nothing
      const beepOn = settings.till?.scanBeep !== false;
      const take = (item: CatalogItem, h: BarcodeHit | null, qty?: number) => {
        scanBeep('ok', beepOn);
        if (checkingRef.current) handlers.current.showPrice(item, h);
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
      scanBeep('error', beepOn);
      if (reading && !weighed) {
        setNotice({
          tone: 'warning',
          text: `ملصق ميزان لصنف رقمه ${reading.itemCode}، ولا يوجد منتج بهذا الباركود. أضف الرقم باركوداً للمنتج.`,
        });
        return;
      }
      // Decision 15: «أضف صنف جديد» right here for a user who manages the catalog, or after a manager's code
      // (it needs the server: online only, said so when it is not)
      setNotice({
        tone: 'warning',
        text: `الباركود ${code} غير معروف على هذا الجهاز. ابحث عن الصنف باسمه، أو أضفه صنفاً جديداً.`,
        actionText: 'أضف صنف جديد',
        onAction: () => {
          setNotice(null);
          setMode({ kind: 'newProduct', barcode: code });
        },
      });
    },
    [catalog, add, settings.scaleBarcode, settings.till, ctx],
  );

  const keypadOpen =
    mode.kind === 'line' ||
    mode.kind === 'fee' ||
    mode.kind === 'invoice' ||
    mode.kind === 'approve' ||
    mode.kind === 'batchApprove' ||
    mode.kind === 'serial' ||
    mode.kind === 'rx' ||
    mode.kind === 'holdName' ||
    mode.kind === 'newProduct' ||
    mode.kind === 'waste' ||
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
  // The selected line opens in place with its buttons: bring all of it into view, above the totals
  useEffect(() => {
    if (selected === null) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`cart-line-${selected}`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selected]);
  // A panel (quantity, discount, payment…) opens in the items area: on a phone, show that tab
  // (a unit sheet opened from the cart is the exception: it floats over the cart, which stays where it is)
  const sheetOverCart = (mode.kind === 'unit' || mode.kind === 'pick') && mode.replaceLine !== undefined;
  useEffect(() => {
    if (mode.kind !== 'items' && !sheetOverCart) setPhoneView('items');
  }, [mode.kind, sheetOverCart]);
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

  // A quotation opened as the cart keeps the prices as offered; when its customer has contract prices
  // the till only says so («سعر العقد»), it does not price the lines again
  const quotedFor = cart.quotation && !cart.contractPriced ? (cart.customer?.id ?? null) : null;
  useEffect(() => {
    const token = pos.device.token;
    if (!quotedFor || !token || !pos.online()) return;
    let alive = true;
    void fetchContractPrices(quotedFor, token, pos.fetch).then((prices) => {
      if (alive && prices.length > 0)
        setCart((c) => (c.customer?.id === quotedFor ? { ...c, contractPriced: true } : c));
    });
    return () => {
      alive = false;
    };
  }, [quotedFor, pos, setCart]);

  const pieces = useMemo(() => modelPieces(catalog.items), [catalog.items]);
  // «سعر الجملة» shows only where some item has a wholesale price (a clothing shop has none).
  const hasWholesale = useMemo(
    () => catalog.items.some((item) => (item.price.wholesalePriceMinor ?? null) !== null),
    [catalog.items],
  );
  const inCart = useMemo(() => new Set(cart.lines.map((l) => l.variantId)), [cart.lines]);
  // A wholesale customer on the cart (however he got there: the pay panel, a quotation, a held sale) brings the
  // wholesale prices once; the cashier can still switch back to the shelf price by hand
  const tierAppliedFor = useRef<string | null>(null);
  const cartCustomerId = cart.customer?.id ?? null;
  useEffect(() => {
    if (!cartCustomerId) {
      tierAppliedFor.current = null;
      return;
    }
    if (tierAppliedFor.current === cartCustomerId || cart.lines.length === 0) return;
    tierAppliedFor.current = cartCustomerId;
    const known = catalog.customers.find((c) => c.id === cartCustomerId);
    if (known?.priceTier === 'wholesale' && cart.priceTier !== 'wholesale')
      setCart((c) => setPriceTier(c, 'wholesale'));
  }, [cartCustomerId, catalog.customers, cart.priceTier, cart.lines.length, setCart]);
  /** What the cart holds of each piece, thousandths (taken off the stock the picker shows) */
  const inCartQty = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart.lines)
      map.set(l.variantId, (map.get(l.variantId) ?? 0) + (l.qty * l.packQty) / 1000);
    return map;
  }, [cart.lines]);

  /** The boxes each piece is sold in, with the box's price, for the price checker */
  const boxesOf = useCallback(
    (list: readonly CatalogItem[]): NonNullable<PriceCheck['packs']> => {
      const wanted = new Set(list.map((p) => p.variantId));
      const out: Record<
        string,
        { name: string | null; qty: number; priceMinor: number; currency: CurrencyCode }[]
      > = {};
      for (const hit of catalog.byBarcode.values()) {
        const { item, barcode } = hit;
        if (barcode.packQty === 1000 || !wanted.has(item.variantId)) continue;
        const rows = (out[item.variantId] ??= []);
        if (rows.some((r) => r.qty === barcode.packQty)) continue;
        rows.push({
          name: barcode.packName,
          qty: barcode.packQty,
          priceMinor: packPrice(item.price.priceMinor, barcode.packQty, barcode.packPriceMinor),
          currency: item.price.currency,
        });
      }
      return out;
    },
    [catalog.byBarcode],
  );

  /** Shows an item's price and stock (all its sizes and colours) and adds nothing */
  const showPrice = useCallback(
    (item: CatalogItem, hit?: BarcodeHit | null) => {
      const model = pieces.get(item.productId);
      const packQty = hit?.barcode.packQty ?? 1000;
      setCheck({
        name: model ? (model[0]!.productName ?? item.name) : item.name,
        pieces: model ? orderPieces(model) : [item],
        focus: item.variantId,
        packs: boxesOf(model ?? [item]),
        pack:
          hit && packQty !== 1000
            ? {
                name: hit.barcode.packName,
                qty: packQty,
                priceMinor: packPrice(item.price.priceMinor, packQty, hit.barcode.packPriceMinor),
                currency: item.price.currency,
              }
            : null,
      });
    },
    [pieces, boxesOf],
  );

  // The tiles and the search field call these; they stay the same function while the cart changes,
  // so the memoised grid is not drawn again for it.
  // The boxes an item is sold in (its pack barcodes, one per box size), for the piece-or-box question
  const packsByVariant = useMemo(() => {
    const map = new Map<string, BarcodeHit[]>();
    for (const hit of catalog.byBarcode.values()) {
      if (hit.barcode.packQty === 1000) continue;
      const list = map.get(hit.item.variantId) ?? [];
      if (!list.some((h) => h.barcode.packQty === hit.barcode.packQty)) list.push(hit);
      map.set(hit.item.variantId, list);
    }
    return map;
  }, [catalog.byBarcode]);
  // The unit chosen for an item IN THIS SALE: one tap adds it again. A new sale starts from the question
  // (the piece or the box?), never from the unit remembered from an earlier day: a box by a mis-tap is costly
  const saleUnits = useRef<Record<string, string>>({});
  useEffect(() => {
    if (cart.lines.length === 0) saleUnits.current = {};
  }, [cart.lines.length]);
  const handlers = useRef({ add, scan, showPrice, packsByVariant, saleUnits });
  handlers.current = { add, scan, showPrice, packsByVariant, saleUnits };
  // A second tap on «أضف» lands on the tile that appears under the closed picker: swallowed for a moment
  const pickerAddedAt = useRef(0);
  // Leaving a dialog or panel (hold, price, size...) back to the grid: its last click must not reach a tile
  const lastKind = useRef(mode.kind);
  useEffect(() => {
    if (lastKind.current !== mode.kind && mode.kind === 'items') armClickGuard();
    lastKind.current = mode.kind;
  }, [mode.kind]);
  const pickItem = useCallback((item: CatalogItem, hit?: BarcodeHit | null) => {
    if (Date.now() - pickerAddedAt.current < 350) return;
    if (checkingRef.current) handlers.current.showPrice(item, hit);
    else if (!hit && handlers.current.packsByVariant.has(item.variantId)) {
      // Picked with no barcode: the unit chosen earlier in THIS sale goes in with one tap; otherwise the piece or which box?
      const last = handlers.current.saleUnits.current[item.variantId];
      const pack =
        last && last !== 'piece'
          ? handlers.current.packsByVariant.get(item.variantId)!.find((h) => h.barcode.id === last)
          : undefined;
      if (last === 'piece' || pack) {
        handlers.current.add(item, pack ?? null);
        setJustAdded(`${item.name} · ${unitName(pack ?? null)}`);
      } else setMode({ kind: 'unit', variantId: item.variantId });
    } else handlers.current.add(item, hit);
  }, []);
  const pickModel = useCallback(
    (productId: string, size?: { option: string; value: string }) => {
      if (Date.now() - pickerAddedAt.current < 350) return;
      if (checkingRef.current) {
        const model = pieces.get(productId);
        if (model)
          setCheck({
            name: model[0]!.productName ?? model[0]!.name,
            pieces: orderPieces(model),
            focus: null,
            packs: boxesOf(model),
          });
      } else {
        const model = pieces.get(productId);
        // A size chip tapped on a model whose only choice is the size: that piece goes in at once
        const only =
          size && model && optionsOf(model).length === 1
            ? pieceFor(model, { [size.option]: size.value }, 1)
            : null;
        if (only && (typeof only.stockQty !== 'number' || only.stockQty > 0)) {
          handlers.current.add(only, null);
          setJustAdded(only.name);
        } else
          setMode({ kind: 'pick', productId, ...(size ? { initial: { [size.option]: size.value } } : {}) });
      }
    },
    [pieces, boxesOf],
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
    // A line the kitchen already has is cancelled on the server, with a reason and a manager's code
    if (
      props.hallTools &&
      (cart.sent?.[lineNo] ?? 0) > 0 &&
      (cart.hall?.lineIds?.[lineNo]?.length ?? 0) > 0
    ) {
      setSelected(null);
      setMode({ kind: 'cancelSent', lineNo });
      return;
    }
    removeNow(lineNo, index);
  }

  function removeNow(lineNo: number, index: number, undoable = true) {
    // «تراجع» is for a line only this till knew about: a cancellation sent to the kitchen stays
    if (undoable) setRemoved({ line: cart.lines[index]!, index });
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
      // A service's fee is the price itself: it may be above the shelf price (goods can only go lower)
      if (value.mode === 'price' && catalog.byVariant.get(line.variantId)?.isService) {
        return value.minor > 0 ? { need: null } : { error: 'اكتب الأجرة بالأرقام.' };
      }
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
    // The fee of a service becomes the line's price (no discount is made of it, so it can be above the shelf price)
    const patch: Partial<Line> =
      value.mode === 'price' && catalog.byVariant.get(line.variantId)?.isService
        ? { priceMinor: value.minor, priceCurrency: ctx.currency, adjustment: null, priceTyped: true }
        : linePatch(line, value);
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
      if (cart.lines.length > 0) holdSale();
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
  // The dollar line shows only while the latest settings still offer that currency
  const shownRate = catalog.rates.find((r) =>
    settings.enabledCurrencies.includes(r.unit === ctx.currency ? r.quote : r.unit),
  );
  const foreign = shownRate ? (shownRate.unit === ctx.currency ? shownRate.quote : shownRate.unit) : null;
  const totals = priced?.priced.totals;
  const lineCount = cart.lines.length;
  const wholesaleOn = cart.priceTier === 'wholesale';
  const showWholesale =
    (session.permissions.has('sale.wholesale') && hasWholesale) ||
    wholesaleOn ||
    Boolean(cart.contractPriced);
  const canHoldForCustomer = priced !== null && !cart.onlineOrder;
  // Round 38 (#41): «تالف / هدر» for the stores that throw away what spoils (or that set their reasons)
  const canWaste = showsWaste(settings.sectors, settings.till);
  const ticketTools =
    waitingOnline.length > 0 ||
    canHoldForCustomer ||
    priced !== null ||
    showWholesale ||
    canWaste ||
    props.heldCount > 0;
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

  // The cart's warnings in one row: how many, and which lines carry one (a ⚠ at the line)
  const warnRows =
    guard.blocks.length +
    (batchWaits ? guard.approvals.length : 0) +
    guard.stockBlocks.length +
    guard.stockWarns.length;
  const warnDanger = guard.blocks.length + guard.stockBlocks.length > 0;
  const lineWarn = (line: Line): 'danger' | 'warning' | null => {
    if (
      guard.blocks.some((i) => i.lineNo === line.lineNo) ||
      guard.stockBlocks.some((i) => i.variantId === line.variantId)
    )
      return 'danger';
    if (
      (batchWaits && guard.approvals.some((i) => i.lineNo === line.lineNo)) ||
      guard.stockWarns.some((i) => i.variantId === line.variantId) ||
      unnumbered.some((l) => l.lineNo === line.lineNo) ||
      needs.has(line.lineNo)
    )
      return 'warning';
    return null;
  };
  // Why «ادفع» is greyed, in words, and where to go to fix it: tapping the reason jumps to the line
  const jumpToLine = (lineNo: number) => {
    setPhoneView('cart');
    setSelected(lineNo);
    window.setTimeout(() => {
      document
        .getElementById(`cart-line-${lineNo}`)
        ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 30);
  };
  // The line a chosen alternative replaces: the one the panel was opened for, when it is blocked
  const replacedLine =
    mode.kind === 'alternatives' &&
    mode.lineNo !== undefined &&
    // (an expired line that only waits for the manager's code is replaced too: «بيع المنتهي برمز المدير»)
    (guard.blocks.some((b) => b.lineNo === mode.lineNo) ||
      guard.approvals.some((b) => b.lineNo === mode.lineNo && b.expiredQty > 0))
      ? cart.lines.find((l) => l.lineNo === mode.lineNo)
      : undefined;
  const payBlock: { text: string; go: () => void } | null = (() => {
    if (canPay || lineCount === 0) return null;
    const serial = unnumbered[0];
    if (serial)
      return {
        text: `أدخل الرقم التسلسلي لـ ${serial.name}`,
        go: () => {
          jumpToLine(serial.lineNo);
          setMode({ kind: 'serial', lineNo: serial.lineNo });
        },
      };
    const unfed = cart.lines.find((l) => isUnfedService(l, catalog.byVariant));
    if (unfed) return { text: `اكتب أجرة ${unfed.name}`, go: () => jumpToLine(unfed.lineNo) };
    const [needLine] = [...needs.keys()];
    if (needLine !== undefined) {
      const l = cart.lines.find((x) => x.lineNo === needLine);
      return { text: `يحتاج موافقة المدير: ${l?.name ?? ''}`.trim(), go: () => jumpToLine(needLine) };
    }
    if (invoiceNeeds)
      return {
        text: NEED_TEXT[invoiceNeeds],
        go: () => setMode({ kind: 'approve', lineNo: null, need: invoiceNeeds }),
      };
    if (batchWaits)
      return {
        text: 'ينقص موافقة المدير على بيع بلا دفعة صالحة',
        go: () => setMode({ kind: 'batchApprove' }),
      };
    const bad = guard.blocks[0] ?? null;
    if (bad) return { text: blockText(bad), go: () => jumpToLine(bad.lineNo) };
    const out = guard.stockBlocks[0];
    const outLine = out ? cart.lines.find((l) => l.variantId === out.variantId) : undefined;
    if (outLine)
      return { text: `الكمية أكبر من المتوفر: ${outLine.name}`, go: () => jumpToLine(outLine.lineNo) };
    return null;
  })();
  // «قطعتان · خدمة»: a service is work, not a piece
  const serviceCount = cart.lines.filter((l) => catalog.byVariant.get(l.variantId)?.isService).length;
  const pieceTotal = pieceCount({
    ...cart,
    lines: cart.lines.filter((l) => !catalog.byVariant.get(l.variantId)?.isService),
  });

  const cartPanel = (
    <>
      {/* The ticket's head: what it is, who sells, and the actions on the whole ticket */}
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-3">
          <IconChip size="md">
            <CartIcon size={20} />
          </IconChip>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate text-lg/6 font-semibold text-ink">
              {lineCount === 0 ? 'فاتورة جديدة' : 'الفاتورة الحالية'}
            </h2>
            {/* Who the sale is for: a quotation's or a picked customer's name, never cut short on a phone */}
            {cart.customer?.name ? (
              <p className="text-sm/5 font-semibold text-ink">
                <bdi>{cart.customer.name}</bdi>
              </p>
            ) : null}
            {/* Wraps between its two parts rather than cut: on a phone the seller box shares this row */}
            <p className="flex flex-wrap gap-x-1 text-sm/5 text-ink-muted">
              {lineCount === 0 ? (
                'لا أسطر بعد'
              ) : (
                <>
                  <span className="me-2 whitespace-nowrap">
                    {counted(lineCount, ['سطر واحد', 'سطران', 'أسطر', 'سطراً'], digits)}
                  </span>
                  <span className="whitespace-nowrap">
                    {pieceTotal > 0
                      ? counted(pieceTotal, ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'], digits)
                      : null}
                    {pieceTotal > 0 && serviceCount > 0 ? ' + ' : null}
                    {serviceCount > 0
                      ? counted(serviceCount, ['خدمة', 'خدمتان', 'خدمات', 'خدمة'], digits)
                      : null}
                  </span>
                </>
              )}
            </p>
          </div>
          {staff.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2">
              {/* A small chip with the seller's name: the native list opens from it (named «البائع» for screen readers) */}
              <select
                aria-label="البائع"
                value={seller}
                onChange={(e) => {
                  setSeller(e.target.value);
                  void pos.local.set(SELLER_KEY, { by: session.userId, id: e.target.value });
                  const picked = e.target.value;
                  if (cart.lines.length > 0) setCart((c) => ({ ...c, sellerId: picked }));
                }}
                className="min-h-9 max-w-32 truncate rounded-full border border-line bg-surface-muted ps-3 pe-1 text-sm font-semibold text-ink"
              >
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
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
                title="طلبات المتجر التي قبلها المدير وتنتظر البيع هنا. الطلبات الجديدة تظهر عند المدير حتى يقبلها."
                onClick={() => setMode({ kind: 'online' })}
                className="border-brand/40 bg-brand-soft text-brand-ink"
              >
                <span aria-hidden="true">طلبات جاهزة</span>
                <span
                  aria-hidden="true"
                  className="num grid h-7 min-w-7 place-items-center rounded-full bg-brand px-2 text-sm font-bold text-on-brand shadow-e1"
                >
                  {displayNumber(String(waitingOnline.length), digits)}
                </span>
              </Button>
            ) : null}
            {/* The rest of the ticket's tools in one «⋯»: hold for a customer, a quotation, the wholesale price */}
            {canHoldForCustomer || priced || showWholesale || canWaste ? (
              <Menu
                label="أدوات الفاتورة"
                align="start"
                className="w-60"
                trigger={
                  <Button variant="ghost" size="md" icon={<MoreIcon />} aria-label="أدوات الفاتورة">
                    المزيد
                  </Button>
                }
              >
                {canHoldForCustomer ? (
                  <MenuItem icon={<CalendarIcon />} onSelect={() => setMode({ kind: 'hold' })}>
                    احجز
                  </MenuItem>
                ) : null}
                {priced ? (
                  <MenuItem icon={<PrintIcon />} onSelect={() => setQuoteAsk(priced)}>
                    عرض سعر
                  </MenuItem>
                ) : null}
                {showWholesale ? (
                  <MenuItem
                    icon={<OfferIcon />}
                    onSelect={() =>
                      setCart((c) => setPriceTier(c, c.priceTier === 'wholesale' ? 'retail' : 'wholesale'))
                    }
                  >
                    {wholesaleOn ? 'ارجع إلى سعر المفرق' : cart.contractPriced ? 'سعر العقد' : 'سعر الجملة'}
                  </MenuItem>
                ) : null}
                {canWaste ? (
                  <MenuItem icon={<DeleteIcon />} onSelect={() => setMode({ kind: 'waste' })}>
                    تالف / هدر
                  </MenuItem>
                ) : null}
              </Menu>
            ) : null}
            {/* On, the wholesale price shows beside the tools as a lit switch: one tap turns it off */}
            {showWholesale && wholesaleOn ? (
              <Button
                variant="primary"
                size="md"
                aria-pressed
                icon={<CheckIcon size={16} />}
                title="اضغط للرجوع إلى سعر المفرق"
                onClick={() => setCart((c) => setPriceTier(c, 'retail'))}
              >
                {cart.contractPriced ? 'سعر العقد' : 'سعر الجملة'}
              </Button>
            ) : null}
            <span className="flex-1" />
            {props.heldCount > 0 ? (
              <button
                type="button"
                aria-label="افتح الفواتير المعلّقة"
                title="الفواتير المعلّقة: اضغط لفتح القائمة"
                onClick={() => setMode({ kind: 'heldList' })}
                className="min-h-11 rounded-full transition-opacity duration-120 ease-standard hover:opacity-80"
              >
                <Badge tone="warning">{`${props.heldCount} معلّقة`}</Badge>
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
          {props.hallTools?.order && cart.hall ? (
            <Button variant="secondary" size="md" onClick={() => setMode({ kind: 'split' })}>
              قسّم الحساب
            </Button>
          ) : null}
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
            {cart.alteration ? 'عربون التقصير' : cart.rental ? 'عربون الإيجار' : 'استبدال'}: القسيمة{' '}
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
      {cart.resumedName ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-muted px-4 py-1.5 text-sm text-ink-muted"
        >
          <ClockIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            فاتورة معلّقة: <span className="font-semibold text-ink">{cart.resumedName}</span>
          </span>
        </div>
      ) : null}
      {cart.exchangeCashBackMinor ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft py-2 ps-4 pe-2 text-sm text-brand-ink"
        >
          <UndoIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            استبدال نقدي: رُدَّ للزبون <Money minor={cart.exchangeCashBackMinor} currency={ctx.currency} />{' '}
            نقداً، والبديل يُدفع كاملاً.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCart((c) => ({ ...c, exchangeCashBackMinor: undefined }))}
          >
            أخفِ
          </Button>
        </div>
      ) : null}
      <div className="min-h-32 flex-1 overflow-y-auto pb-2">
        {lineCount === 0 ? (
          // One short hint line, not a big empty state: the items are one glance away
          <p className="flex items-center justify-center gap-2 px-4 py-6 text-center text-sm text-ink-muted">
            <BarcodeIcon size={20} className="shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold text-ink">السلة فارغة</span> · امسح الباركود أو اختر صنفاً.
            </span>
          </p>
        ) : (
          <ul aria-label="أسطر الفاتورة" className="flex flex-col gap-0.5 p-1">
            {cart.lines.map((line, i) => {
              const p = priced?.lines[i];
              const split = variantSplit(line.name, catalog.byVariant.get(line.variantId));
              const need = needs.get(line.lineNo);
              const adj = line.adjustment;
              const discounted = p !== undefined && p.priced.lineDiscountMinor > 0;
              const promoHint = buyGetHint(line, ctx);
              const percent =
                adj?.kind === 'discount' && adj.discount.type === 'percent' ? adj.discount.bp : null;
              const meta = [
                packLineText(line, (q) => formatQuantity(q, digits)) ??
                  (line.packName ? line.packName : null),
                adj?.kind === 'price' ? 'سعر معدّل' : null,
                // A batch line says which lots it takes and their dates
                ...(takePlan.allocations.get(line.lineNo) ?? [])
                  .filter((b) => b.batchNo)
                  .map((b) => (
                    <span key={`lot-${b.batchNo}`} className="whitespace-nowrap">
                      دفعة <bdi dir="ltr">{b.batchNo}</bdi>
                      {b.expiry ? ` · تنتهي ${dayText(b.expiry, digits)}` : ''}
                    </span>
                  )),
                // A discount on the line: the price before it struck through, then what was taken off
                discounted && p ? (
                  <span key="was" className="whitespace-nowrap text-ink-subtle">
                    <s>
                      <ExactMoney minor={p.priced.grossMinor} currency={ctx.currency} symbol={false} />
                    </s>
                  </span>
                ) : null,
                discounted && p && adj?.kind === 'discount' ? (
                  <span key="d" className="inline-flex items-center gap-1 font-semibold text-info-ink">
                    <PercentIcon size={16} className="shrink-0" aria-hidden="true" />
                    خصم{percent !== null ? ` ${displayNumber(String(percent / 100), digits)}%` : ''}{' '}
                    <ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                discounted && p && adj?.kind === 'price' ? (
                  <span key="pd" className="font-semibold text-info-ink">
                    −<ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                p && p.priced.lineDiscountMinor > 0 && p.discount?.source === 'promotion' ? (
                  <span key="o" className="font-semibold text-success-ink">
                    {p.discount.reason} −
                    <ExactMoney minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
                  </span>
                ) : null,
                promoHint ? (
                  <span key="hint" className="font-semibold text-success-ink">
                    أضف قطعة تأخذ{' '}
                    {promoHint.get === 1 ? 'واحدة' : displayNumber(String(promoHint.get), digits)} مجاناً
                  </span>
                ) : null,
                customerPriceKind(line) !== null ? (
                  <span key="c" className="font-semibold text-info-ink">
                    {shelfPriceOf(line) !== undefined && shelfPriceOf(line)! > line.priceMinor ? (
                      <s className="me-1.5 font-normal text-ink-subtle">
                        <Money
                          minor={unitPriceOf(
                            { priceCurrency: line.priceCurrency, priceMinor: shelfPriceOf(line)! },
                            ctx,
                          )}
                          currency={ctx.currency}
                          symbol={false}
                        />
                      </s>
                    ) : null}
                    {customerPriceKind(line) === 'contract' ? 'سعر العقد' : 'سعر الجملة'}
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
                  id={`cart-line-${line.lineNo}`}
                  name={isolateSizes(split.name)}
                  {...(split.variant ? { variant: isolateSizes(split.variant) } : {})}
                  qtyThousandths={line.qty}
                  unit={line.unitSymbol ?? undefined}
                  unitPriceMinor={p?.unitPriceMinor ?? 0}
                  lineTotalMinor={p?.priced.totalMinor ?? 0}
                  currency={ctx.currency}
                  meta={
                    meta.length > 0 ? (
                      <>
                        {meta.map((m, k) => (
                          <span key={k} className="me-3 inline-block">
                            {m}
                          </span>
                        ))}
                      </>
                    ) : undefined
                  }
                  extra={
                    packsByVariant.has(line.variantId) || line.tracksSerial || pieces.has(line.productId) ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {pieces.has(line.productId) ? (
                          // A wrong size at the fitting: the same line takes another size or colour in place
                          <button
                            type="button"
                            className="min-h-11 rounded-small border border-line-control/50 bg-surface px-3 text-sm font-semibold text-ink"
                            onClick={() =>
                              setMode({
                                kind: 'pick',
                                productId: line.productId,
                                replaceLine: line.lineNo,
                                initial: Object.fromEntries(
                                  (catalog.byVariant.get(line.variantId)?.attributes ?? []).map((a) => [
                                    a.name,
                                    a.value,
                                  ]),
                                ),
                              })
                            }
                          >
                            {changeLabel(pieces.get(line.productId)!)} ▾
                          </button>
                        ) : null}
                        {packsByVariant.has(line.variantId) ? (
                          // The unit sold (piece or a box): one tap to change it, at the same quantity
                          <button
                            type="button"
                            aria-label="غيّر الوحدة"
                            className="min-h-11 rounded-small border border-line-control/50 bg-surface px-3 text-sm font-semibold text-ink"
                            onClick={() =>
                              setMode({ kind: 'unit', variantId: line.variantId, replaceLine: line.lineNo })
                            }
                          >
                            {line.packName ?? (line.packQty === 1000 ? 'قطعة' : 'علبة')} ▾
                          </button>
                        ) : null}
                        {line.tracksSerial ? (
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
                            {line.serials?.length
                              ? `${serialLabel(settings.sectors)} ${line.serials.join('، ')}`
                              : 'اكتب الرقم التسلسلي'}
                          </button>
                        ) : null}
                      </span>
                    ) : undefined
                  }
                  warning={lineWarn(line)}
                  selected={selected === line.lineNo}
                  onSelect={() => setSelected((s) => (s === line.lineNo ? null : line.lineNo))}
                  onRemove={() => remove(line.lineNo)}
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
                  {/* One row: the quantity, then «خصم / السعر» (they wrap only when a manager's code joins) */}
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <div className="flex shrink-0 items-center gap-2">
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
                        <div
                          dir="ltr"
                          className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1"
                        >
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
                    </div>
                    <div className="grid min-w-40 flex-1 auto-cols-fr grid-flow-col gap-2">
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
                  </div>
                </CartLine>
              );
            })}
            {/* The free pieces a promotion earned: derived from the cart, so they come and go with it */}
            {(priced?.lines.slice(cart.lines.length) ?? []).map((free) => (
              <li
                key={free.lineNo}
                aria-label={`مجاني: ${free.name}`}
                className="flex items-center gap-2 rounded-small bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink"
              >
                <span className="min-w-0 flex-1">
                  {free.name} × {formatQuantity(free.qty, digits)}
                </span>
                <span className="shrink-0">مجاناً · {free.discount?.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cart.invoiceDiscount && totals && totals.invoiceDiscountMinor > 0 ? (
        <div
          role="status"
          aria-label="خصم الفاتورة"
          title={`يشمل كل الأسطر${cart.lines.some((l) => l.isService) ? ' ما عدا الخدمات' : ''}، وما تضيفه بعد الآن.`}
          className="mx-3 mb-1.5 flex shrink-0 items-center gap-3 rounded-card border border-info/20 bg-info-soft py-0.5 ps-3 pe-1 text-sm text-info-ink"
        >
          <PercentIcon size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">
              خصم الفاتورة{' '}
              {cart.invoiceDiscount.type === 'percent'
                ? `${displayNumber(String(cart.invoiceDiscount.bp / 100), digits)}%`
                : ''}{' '}
              <ExactMoney minor={totals.invoiceDiscountMinor} currency={ctx.currency} symbol={false} />
            </span>
            <span className={cart.lines.some((l) => l.isService) ? 'block text-xs' : 'sr-only'}>
              {cart.lines.some((l) => l.isService)
                ? 'ما عدا الخدمات، وما تضيفه بعد الآن'
                : 'يشمل كل الأسطر، وما تضيفه بعد الآن.'}
            </span>
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
        totalMinor={totalMinor + planFeeMinor}
        currency={ctx.currency}
        label={planFeeMinor > 0 ? 'المطلوب مع رسم التقسيط' : 'المطلوب'}
        breakdown={[
          ...(totals && totals.discountMinor > 0
            ? [
                { label: 'المجموع قبل الخصم', minor: totals.grossMinor },
                { label: 'الخصم · وفّر الزبون', minor: totals.discountMinor, tone: 'info' as const },
              ]
            : []),
          ...(contractSaved > 0 ? [{ label: 'وفّرت', minor: contractSaved, tone: 'info' as const }] : []),
          ...(totals && !settings.taxInclusive && totals.taxMinor > 0
            ? [{ label: 'الضريبة', minor: totals.taxMinor }]
            : []),
          ...(planFeeMinor > 0 ? [{ label: 'رسم التقسيط', minor: planFeeMinor }] : []),
        ]}
        note={
          foreign ? (
            <>
              ≈{' '}
              <Money
                minor={convert(totalMinor, ctx.currency, foreign, rateFor(ctx.rates, foreign, ctx.currency))}
                currency={foreign}
              />{' '}
              · سعر الصرف <bdi className="num">{displayNumber(shownRate!.rate, digits)}</bdi>
            </>
          ) : undefined
        }
        notice={
          guard.blocks.length + guard.stockBlocks.length + guard.stockWarns.length > 0 || batchWaits ? (
            // One collapsible row: two warnings must not push the cart's lines out of the panel
            <CartWarnings
              title={counted(warnRows, ['تنبيه واحد', 'تنبيهان', 'تنبيهات', 'تنبيهاً'], digits)}
              danger={warnDanger}
              forceOpen={Boolean(batchWaits)}
            >
              <BatchBanner
                blocks={guard.blocks}
                approvals={batchWaits ? guard.approvals : []}
                stockBlocks={guard.stockBlocks}
                stockWarns={guard.stockWarns}
                fmt={(q) => formatQuantity(q, digits)}
                onApprove={() => setMode({ kind: 'batchApprove' })}
                {...(settings.pharmacy
                  ? {
                      onAlternatives: (of: { lineNo: number } | { variantId: string }) => {
                        const line =
                          'lineNo' in of ? cart.lines.find((l) => l.lineNo === of.lineNo) : undefined;
                        const variantId = 'variantId' in of ? of.variantId : line?.variantId;
                        if (variantId)
                          setMode({
                            kind: 'alternatives',
                            variantId,
                            ...(line ? { lineNo: line.lineNo } : {}),
                          });
                      },
                    }
                  : {})}
              />
            </CartWarnings>
          ) : undefined
        }
        actions={
          <>
            <button
              type="button"
              aria-label={lineCount === 0 && props.heldCount > 0 ? 'استرجع المعلّقة' : 'علّق'}
              aria-keyshortcuts="F4"
              title="ضع هذه الفاتورة جانباً وأكمل غيرها، ثم استرجعها (F4)"
              onClick={() => {
                if (lineCount > 0) setMode({ kind: 'holdName' });
                else if (props.heldCount === 1) props.onResume(0);
                else setMode({ kind: 'heldList' });
              }}
              disabled={lineCount === 0 && props.heldCount === 0}
              className={CART_QUICK}
            >
              {lineCount === 0 && props.heldCount > 0 ? <UndoIcon size={20} /> : <ClockIcon size={20} />}
              <span>{lineCount === 0 && props.heldCount > 0 ? 'استرجع' : 'علّق'}</span>
            </button>
            {/* One «خصم» in view: while a line is open its own «خصم» is the one; Alt+1 still opens the invoice's */}
            {selected === null ? (
              <button
                type="button"
                aria-label="خصم"
                aria-keyshortcuts="Alt+1"
                title="خصم على الفاتورة (Alt+1)"
                onClick={() => setMode({ kind: 'invoice' })}
                disabled={lineCount === 0}
                className={CART_QUICK}
              >
                <PercentIcon size={20} />
                <span>خصم</span>
              </button>
            ) : null}
            {/* A pharmacy: the same medicine in another brand, in stock, for the line in hand (round 38) */}
            {settings.pharmacy ? (
              <button
                type="button"
                aria-label="بدائل الصنف"
                title="بدائل بنفس المادة الفعالة، متوفرة الآن"
                onClick={() => {
                  const line =
                    cart.lines.find((l) => l.lineNo === selected) ?? cart.lines[cart.lines.length - 1];
                  if (line) setMode({ kind: 'alternatives', variantId: line.variantId, lineNo: line.lineNo });
                }}
                disabled={lineCount === 0}
                className={CART_QUICK}
              >
                <SearchIcon size={20} />
                <span>بدائل</span>
              </button>
            ) : null}
          </>
        }
        onPay={startPay}
        payDisabled={!canPay}
        blockedReason={payBlock?.text}
        onBlockedTap={payBlock?.go}
        payShortcut="F12"
      />
    </>
  );

  const itemsArea = (
    <ItemsArea
      catalog={catalog}
      pieces={pieces}
      bestSellers={best}
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
      reserved={reservedStable.current}
    />
  );
  /** A picker over the grid it was opened from: the grid stays in view behind a scrim, the panel centred on the screen */
  const overPanel = (panel: ReactNode) => (
    <>
      {itemsArea}
      {/* In the page body, not inside the items tab: on a phone that tab is hidden while the cart shows (a unit sheet opened from the cart) */}
      {createPortal(
        <div
          className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/45 p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMode({ kind: 'items' });
          }}
        >
          {panel}
        </div>,
        document.body,
      )}
    </>
  );

  return (
    <CashierShell
      statusBar={props.statusBar}
      cart={cartPanel}
      mobileView={phoneView}
      {...(effectiveMode.kind === 'pay' ? { itemsLabel: 'الدفع', cartLabel: 'السلة' } : {})}
      onMobileView={setPhoneView}
      cartBadge={lineCount > 0 ? displayNumber(String(lineCount), digits) : undefined}
      miniBar={
        lineCount > 0 && mode.kind === 'items' ? (
          // A phone, in the grid: what is in the cart and its total, one tap from the cart (and the pay button there)
          <div
            role="group"
            aria-label="ملخّص السلة"
            className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-3 py-2 shadow-e2"
          >
            <span className="min-w-0 flex-1 text-sm/tight font-semibold text-ink">
              {counted(lineCount, ['صنف واحد', 'صنفان', 'أصناف', 'صنفاً'], digits)}
              <span className="block text-ink-muted">
                المجموع{' '}
                <ExactMoney minor={totalMinor} currency={ctx.currency} className="font-bold text-ink" />
              </span>
            </span>
            <Button size="md" aria-label="افتح السلة" onClick={() => setPhoneView('cart')}>
              عرض السلة
            </Button>
          </div>
        ) : undefined
      }
    >
      {/* In the page body: on a phone the items tab is hidden while the cart shows, and so would a toast inside it */}
      {(justSwapped ?? justAdded) && !asking
        ? createPortal(
            <p
              role="status"
              className="pointer-events-none fixed inset-x-4 bottom-24 z-70 mx-auto flex w-fit max-w-full items-center gap-2 rounded-full bg-success-soft px-4 py-2 text-sm font-semibold text-success-ink shadow-e2 motion-safe:animate-rise"
            >
              <CheckIcon size={16} className="shrink-0" />
              <span className="truncate">
                {justSwapped ? 'بُدّل ✓' : 'أُضيف ✓'} <bdi>{justSwapped ?? justAdded}</bdi>
              </span>
            </p>,
            document.body,
          )
        : null}
      {quoteAsk ? (
        <QuoteDialog
          customerName={cart.customer?.name ?? null}
          busy={quoteBusy}
          onSave={(choice) => void saveQuote(quoteAsk, choice)}
          onClose={() => setQuoteAsk(null)}
        />
      ) : null}
      {outAsk ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setOutAsk(null);
          }}
          size="sm"
          title="لا يوجد مخزون"
          description={`«${outAsk.item.name}» نفد من المخزون. بيع على كل حال؟`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setOutAsk(null)}>
                لا، لا تُضفه
              </Button>
              {/* A pharmacy: the same medicine in another brand, in stock (round 39: also on a phone) */}
              {settings.pharmacy ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const ask = outAsk;
                    setOutAsk(null);
                    setMode({ kind: 'alternatives', variantId: ask.item.variantId });
                  }}
                >
                  بدائل
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  const ask = outAsk;
                  setOutAsk(null);
                  outOk.current = true;
                  try {
                    add(ask.item, ask.hit, ask.weighedQty, ask.choice);
                  } finally {
                    outOk.current = false;
                  }
                }}
              >
                نعم، بِع على كل حال
              </Button>
            </>
          }
        />
      ) : null}
      {zeroAsk ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setZeroAsk(null);
          }}
          size="sm"
          title="السعر 0 — تأكيد؟"
          description={`«${zeroAsk.item.name}» سعره صفر في الأصناف، فيدخل السلة بلا مقابل. أتبيعه هكذا؟`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setZeroAsk(null)}>
                لا، لا تُضفه
              </Button>
              <Button
                onClick={() => {
                  const ask = zeroAsk;
                  setZeroAsk(null);
                  zeroOk.current = true;
                  try {
                    add(ask.item, ask.hit, ask.weighedQty, ask.choice);
                  } finally {
                    zeroOk.current = false;
                  }
                }}
              >
                نعم، أضفه بسعر 0
              </Button>
            </>
          }
        />
      ) : null}
      {quote ? <PrintableQuote data={quote} width={80} /> : null}
      {kitchen ? <PrintableKitchenTicket data={kitchen} /> : null}
      {effectiveMode.kind === 'pay' && priced ? (
        <TillBoundary onBack={() => setMode({ kind: 'items' })}>
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
              onPlanFee={setPlanFeeMinor}
              onCustomer={(picked) =>
                setCart((c) => {
                  if (picked) return { ...c, customer: picked };
                  const { customer: _gone, ...rest } = c;
                  return rest;
                })
              }
              onContractPrices={async (customerId) => {
                // A hospital's or clinic's contract prices (03 › أسعار العقود); none offline
                const prices = pos.device.token
                  ? await fetchContractPrices(customerId, pos.device.token, pos.fetch)
                  : [];
                if (prices.length > 0)
                  setCart((c) => ({ ...applyContractPrices(c, prices), contractPriced: true }));
                return prices.length > 0;
              }}
              onBack={() => setMode({ kind: 'items' })}
              onCompleted={(entry) => {
                // The seller picked is for this sale only
                setSeller(session.userId);
                void pos.local.remove(SELLER_KEY);
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
        </TillBoundary>
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
                    ? catalog.byVariant.get(line.variantId)?.isService &&
                      catalog.byVariant.get(line.variantId)?.price.priceMinor === 0
                      ? 'حدّد الأجرة'
                      : 'سعر جديد في السلة'
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
              onClose={() => {
                // A service whose fee was never entered leaves no line behind (cancel = nothing added)
                const item = catalog.byVariant.get(line.variantId);
                if (item?.isService && item.price.priceMinor === 0 && line.priceMinor === 0)
                  removeNow(line.lineNo, cart.lines.indexOf(line), false);
                else setMode({ kind: 'items' });
              }}
              preview={() => (
                <span>
                  {catalog.byVariant.get(line.variantId)?.isService ? (
                    'خدمة: الأجرة تُحدَّد عند البيع'
                  ) : (
                    <>
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
                    </>
                  )}
                </span>
              )}
            />
          );
        })()
      ) : effectiveMode.kind === 'fee' ? (
        <AdjustPanel
          key={effectiveMode.item.variantId}
          title="حدّد الأجرة"
          subtitle={effectiveMode.item.name}
          modes={['price']}
          initialMode="price"
          compact
          currency={ctx.currency}
          staff={staff}
          check={(value) =>
            value.mode === 'price' && value.minor > 0 ? { need: null } : { error: 'اكتب الأجرة بالأرقام.' }
          }
          onApply={(value) => {
            if (value.mode !== 'price') return;
            const { item, hit } = effectiveMode;
            setMode({ kind: 'items' });
            add(item, hit, undefined, undefined, value.minor);
          }}
          onClose={() => setMode({ kind: 'items' })}
          preview={() => <span>خدمة: الأجرة تُحدَّد عند البيع</span>}
        />
      ) : effectiveMode.kind === 'invoice' ? (
        <AdjustPanel
          title="خصم على الفاتورة"
          subtitle={(() => {
            // A service (alteration fee, rent, contract) never takes the invoice discount
            const services = cart.lines.filter((l) => l.isService).length;
            const goods = displayNumber(String(lineCount - services), digits);
            return `يشمل كل أسطر الفاتورة (${goods})${services > 0 ? ' ما عدا الخدمات' : ''} وما تضيفه بعدها`;
          })()}
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
      ) : effectiveMode.kind === 'batchApprove' ? (
        <SalePanel title="موافقة على بيع بلا دفعة صالحة" icon={<KeyIcon size={20} />}>
          <ManagerCode
            staff={staff}
            permission="sale.discount_over_limit"
            reason={
              batchPlan.uncovered.some((i) => i.expiredQty > 0)
                ? 'دفعة منتهية الصلاحية: يوافق المدير على بيعها، ويُسجَّل ذلك'
                : 'لا دفعة صالحة تكفي بعض الأصناف: يوافق المدير على بيعها'
            }
            onApproved={(approval) => {
              setCart((c) => ({ ...c, batchApproval: { sig: batchPlan.signature, approval } }));
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
          catalog={catalog}
          staff={staff}
          onSave={(serials, override) => {
            setCart((c) =>
              updateLine(c, effectiveMode.lineNo, {
                serials,
                serialOverrides: override ? serials : [],
                serialApprovedBy: override?.approval.userId ?? null,
              }),
            );
            setMode({ kind: 'items' });
          }}
          onCancel={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'unit' && catalog.byVariant.has(effectiveMode.variantId) ? (
        overPanel(
          <UnitPanel
            key={effectiveMode.variantId}
            item={catalog.byVariant.get(effectiveMode.variantId)!}
            packs={packsByVariant.get(effectiveMode.variantId) ?? []}
            lastUnit={lastUnits[effectiveMode.variantId]}
            onPick={(hit) => {
              const item = catalog.byVariant.get(effectiveMode.variantId)!;
              const next = { ...lastUnits, [effectiveMode.variantId]: hit ? hit.barcode.id : 'piece' };
              setLastUnits(next);
              saleUnits.current[effectiveMode.variantId] = hit ? hit.barcode.id : 'piece';
              void pos.local.set(LAST_UNIT_KEY, next);
              setMode({ kind: 'items' });
              const old = effectiveMode.replaceLine
                ? cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                : undefined;
              if (old) {
                // The same quantity in the other unit: the line is replaced, not added to
                setCart((c) => {
                  const index = c.lines.findIndex((l) => l.lineNo === old.lineNo);
                  const without = removeLine(c, old.lineNo);
                  const next = addItem(without, item, hit, old.qty);
                  // The new line takes the old one's place, not the end of the cart
                  const added = next.lines.length > without.lines.length ? next.lines.at(-1) : undefined;
                  if (!added || index < 0) return next;
                  const lines = next.lines.slice(0, -1);
                  lines.splice(Math.min(index, lines.length), 0, added);
                  return { ...next, lines };
                });
                setSelected(null);
              } else {
                add(item, hit);
                setJustAdded(`${item.name} · ${unitName(hit)}`);
              }
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />,
        )
      ) : effectiveMode.kind === 'pick' && pieces.get(effectiveMode.productId) ? (
        overPanel(
          <VariantPicker
            key={effectiveMode.productId}
            {...(effectiveMode.initial ? { initial: effectiveMode.initial } : {})}
            {...(effectiveMode.replaceLine !== undefined
              ? {
                  actionLabel: 'بدّل في السلة',
                  swap: true,
                  ...(cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                    ? { fixedQty: cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)!.qty }
                    : {}),
                }
              : {})}
            name={pieces.get(effectiveMode.productId)![0]!.productName ?? ''}
            pieces={pieces.get(effectiveMode.productId)!}
            inCart={inCartQty}
            priceNote={(minor, currency) =>
              catalog.settings
                ? dollarNote(minor, currency, { base: catalog.settings.baseCurrency, rates: catalog.rates })
                : null
            }
            Kind={placeholderIconFor({
              categoryName: null,
              name: pieces.get(effectiveMode.productId)![0]!.productName ?? '',
              sectors: catalog.settings?.sectors ?? [],
            })}
            onAdd={(piece, qty) => {
              pickerAddedAt.current = Date.now();
              setMode({ kind: 'items' });
              const old =
                effectiveMode.replaceLine !== undefined
                  ? cart.lines.find((l) => l.lineNo === effectiveMode.replaceLine)
                  : undefined;
              if (old) {
                // Another size or colour for the same quantity: the line is replaced where it stands
                setCart((c) => {
                  const index = c.lines.findIndex((l) => l.lineNo === old.lineNo);
                  const without = removeLine(c, old.lineNo);
                  const next = addItem(without, piece, null, old.qty);
                  const added = next.lines.length > without.lines.length ? next.lines.at(-1) : undefined;
                  if (!added || index < 0) return next;
                  const lines = next.lines.slice(0, -1);
                  lines.splice(Math.min(index, lines.length), 0, added);
                  return { ...next, lines };
                });
                setSelected(null);
                setJustSwapped(piece.name);
                return;
              }
              setJustAdded(piece.name);
              // The picker has already asked about a size with nothing left: no second question
              outOk.current = true;
              try {
                add(piece, null, qty > 1 ? qty * 1000 : undefined);
              } finally {
                outOk.current = false;
              }
            }}
            onCancel={() => setMode({ kind: 'items' })}
          />,
        )
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
      ) : effectiveMode.kind === 'alternatives' && catalog.byVariant.get(effectiveMode.variantId) ? (
        <Suspense fallback={null}>
          <AlternativesPanel
            source={catalog.byVariant.get(effectiveMode.variantId)!}
            catalog={catalog}
            today={businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff)}
            replacing={replacedLine?.name}
            onPick={(picked, available) => {
              setMode({ kind: 'items' });
              // The blocked line (no valid batch, expired) goes: the alternative takes its place with its quantity,
              // as much as the alternative has (round 39)
              if (replacedLine) {
                const without = removeLine(cartRef.current, replacedLine.lineNo);
                cartRef.current = without;
                setCart(() => without);
                setSelected(null);
                const same = replacedLine.packQty === 1000 ? replacedLine.qty : 1000;
                add(picked, null, Math.max(1000, Math.min(same, available)));
                return;
              }
              add(picked, null);
            }}
            onClose={() => setMode({ kind: 'items' })}
          />
        </Suspense>
      ) : effectiveMode.kind === 'newProduct' ? (
        <Suspense fallback={null}>
          <NewProductPanel
            barcode={effectiveMode.barcode}
            currency={ctx.currency}
            categories={catalog.categoryChoices ?? []}
            staff={staff}
            canManage={session.permissions.has('catalog.manage')}
            userId={session.userId}
            businessDate={() => businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff)}
            pharmacy={Boolean(settings.pharmacy)}
            onClose={() => setMode({ kind: 'items' })}
            onDone={(added) => {
              setMode({ kind: 'items' });
              // It goes into the cart as soon as the catalog holds it (the effect above), so the cashier scans nothing twice
              setJustMade({ variantId: added.variantId, name: added.name, offline: added.offline });
            }}
          />
        </Suspense>
      ) : effectiveMode.kind === 'waste' ? (
        <Suspense fallback={null}>
          <WastePanel
            catalog={catalog}
            reasons={settings.till?.wasteReasons}
            staff={staff}
            canAdjust={session.permissions.has('inventory.adjust')}
            userId={session.userId}
            onClose={() => setMode({ kind: 'items' })}
            onDone={(text) => {
              setMode({ kind: 'items' });
              setNotice({ tone: 'info', text });
            }}
          />
        </Suspense>
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
          days={holdExpiryDaysOf(settings.till)}
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
            holdSale(name);
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
          sellerOf={(c) => (c.sellerId ? (staff.find((m) => m.id === c.sellerId)?.fullName ?? null) : null)}
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
          onMove={props.hallTools?.onMoveTable}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'split' && props.hallTools?.order ? (
        <SplitBill
          order={props.hallTools.order}
          currency={ctx.currency}
          blocked={
            cart.lines.some((l) => l.qty > (cart.hall?.known[l.lineNo] ?? 0))
              ? 'في الطلب أصناف لم تُرسل بعد. أرسلها للمطبخ ثم قسّم الحساب.'
              : null
          }
          totalOf={(lineIds) => {
            try {
              const part = cartFromOrder(props.hallTools!.order!, catalog, null, { lineIds }).cart;
              return part.lines.length > 0 ? priceCart(part, ctx).priced.totals.totalMinor : 0;
            } catch {
              return 0;
            }
          }}
          onItems={(lineIds) => {
            setMode({ kind: 'items' });
            props.hallTools!.onSplitItems(lineIds);
          }}
          onEqual={(parts) => {
            setMode({ kind: 'items' });
            props.hallTools!.onSplitEqual(parts);
          }}
          onClose={() => setMode({ kind: 'items' })}
        />
      ) : effectiveMode.kind === 'cancelSent' && lineOf(effectiveMode.lineNo) && props.hallTools ? (
        <CancelSentLine
          name={lineOf(effectiveMode.lineNo)!.name}
          staff={staff}
          onBack={() => setMode({ kind: 'items' })}
          onLocalOnly={() => {
            const at = cart.lines.findIndex((l) => l.lineNo === effectiveMode.lineNo);
            setMode({ kind: 'items' });
            if (at >= 0) removeNow(effectiveMode.lineNo, at);
          }}
          onConfirm={async (input) => {
            const answer = await props.hallTools!.cancelSent(effectiveMode.lineNo, input);
            if (answer.kind === 'ok') {
              const at = cart.lines.findIndex((l) => l.lineNo === effectiveMode.lineNo);
              setMode({ kind: 'items' });
              if (at >= 0) removeNow(effectiveMode.lineNo, at, false);
              setNotice({
                tone: 'info',
                text: answer.queued
                  ? 'حُذف البند. سيصل إلغاؤه للمطبخ حين يعود الاتصال.'
                  : 'أُلغي البند ووصل الإلغاء لشاشة المطبخ.',
              });
            }
            return answer;
          }}
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
        itemsArea
      )}
    </CashierShell>
  );
}
