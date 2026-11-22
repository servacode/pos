import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convert } from '@serva/core/money';
import { businessDateOf, rateFor } from '@serva/core/sale';
import type { PromotionAudience } from '@serva/core/promotions';
import { parseScaleBarcode, qtyForPrice } from '@serva/core/scale';
import { missingPrescription, prescriptionNeed } from '@serva/core/pharmacy';
import { Button, CheckIcon, CashierShell, Dialog, displayNumber, useDigits } from '@serva/ui';
import { barcodeKey, type BarcodeHit, type CatalogItem } from '../catalog';
import { ExactMoney } from '../ExactMoney';
import { useRep } from '../../rep/state';
import { counted } from '../format';
import { QuoteDialog, type QuoteChoice } from './QuoteDialog';
import {
  addItem,
  invoiceNeed,
  lineNeed,
  missingSerials,
  priceCart,
  contractSavingMinor,
  type ItemChoice,
  type ApprovalNeed,
  type ApprovalRules,
  type CartLine as Line,
  type PricedCart,
  type PricingContext,
} from './cart';
import { useScanner } from './useScanner';
import { scanBeep } from '../beep';
import { fetchContractPrices } from '../rentals/api';
import { PrintableQuote, type QuoteData } from '../receipt/Quote';
import { quotationInputOf, saveQuotation } from '../quotations/api';
import { PrintableKitchenTicket, type KitchenData } from '../receipt/KitchenTicket';
import { ItemsArea, type PriceCheck } from './ItemsArea';
import { armClickGuard } from './clickGuard';
import { isUnfedService } from './serviceFee';
import { waitingOrders } from './onlineOrders';
import { CartHeader } from './CartHeader';
import { CartBanners } from './CartBanners';
import { CartLines } from './CartLines';
import { CartTotals } from './CartTotals';
import { SaleModePanel } from './SaleModePanel';
import { useSaleCatalogViews } from './useSaleCatalogViews';
import { useSalePickers } from './useSalePickers';
import { saleView } from './saleView';
import { useSaleStock } from './useSaleStock';
import { useSaleDevice } from './useSaleDevice';
import { usePayResume } from './usePayResume';
import { useSaleAdd } from './useSaleAdd';
import { useSaleKeys } from './useSaleKeys';
import { lineActions } from './lineActions';
import { type SaleMode, type SaleNotice, type SaleScreenProps } from './saleTypes';

export type { SaleMode, SaleScreenProps } from './saleTypes';

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
  const {
    activePromotions,
    posServices,
    soldOnline,
    setSoldOnline,
    reserved,
    batchPlan,
    takePlan,
    guard,
    batchWaits,
  } = useSaleStock({ catalog, cart, settings, heldList: props.heldList, done: props.done });
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
  const [notice, setNotice] = useState<SaleNotice | null>(null);
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
  const { pos, best, seller, setSeller, lastUnits, setLastUnits, holdSale } = useSaleDevice({
    catalog,
    cart,
    session,
    staff,
    setNotice,
    onHold: props.onHold,
  });
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
  usePayResume({ pos, priced, cart, session, mode, totalMinor, setMode });
  const { onTotal } = props;
  useEffect(() => onTotal?.(totalMinor), [onTotal, totalMinor]);
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
  const add = useSaleAdd({
    ctx,
    multiplier,
    setCart,
    mode,
    props,
    settings,
    session,
    digits,
    setMode,
    setSelected,
    setZeroAsk,
    setOutAsk,
    setNotice,
    setMultiplier,
    setBump,
    zeroOk,
    outOk,
    cartRef,
  });

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

  const { pieces, hasWholesale, inCart, inCartQty, boxesOf, showPrice } = useSaleCatalogViews({
    catalog,
    cart,
    setCart,
    setCheck,
  });

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
  const { pickItem, pickModel } = useSalePickers({
    handlers,
    checkingRef,
    pickerAddedAt,
    pieces,
    boxesOf,
    setMode,
    setJustAdded,
    setCheck,
  });
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
  const { remove, removeNow, changeQty, lineOf, checkLine, applyLine, checkInvoice } = lineActions({
    cart,
    setCart,
    setSelected,
    setMode,
    setRemoved,
    mode,
    hallTools: props.hallTools,
    catalog,
    ctx,
    rules,
  });

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
  useSaleKeys({
    props,
    mode,
    checking,
    keypadOpen,
    cart,
    canPay,
    setMode,
    searchRef,
    stopChecking,
    startChecking,
    holdSale,
    startPay,
  });

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────
  const {
    shownRate,
    foreign,
    totals,
    lineCount,
    wholesaleOn,
    showWholesale,
    canHoldForCustomer,
    canWaste,
    ticketTools,
    orderType,
    warnRows,
    warnDanger,
    lineWarn,
    replacedLine,
    payBlock,
    serviceCount,
    pieceTotal,
  } = saleView({
    catalog,
    settings,
    ctx,
    cart,
    priced,
    session,
    mode,
    hasWholesale,
    waitingOnline,
    heldCount: props.heldCount,
    defaultOrderType,
    guard,
    batchWaits,
    unnumbered,
    needs,
    invoiceNeeds,
    canPay,
    setPhoneView,
    setSelected,
    setMode,
  });

  const cartPanel = (
    <>
      <CartHeader
        lineCount={lineCount}
        pieceTotal={pieceTotal}
        serviceCount={serviceCount}
        cart={cart}
        setCart={setCart}
        staff={staff}
        session={session}
        seller={seller}
        setSeller={setSeller}
        pos={pos}
        ticketTools={ticketTools}
        waitingOnline={waitingOnline}
        canHoldForCustomer={canHoldForCustomer}
        priced={priced}
        showWholesale={showWholesale}
        wholesaleOn={wholesaleOn}
        canWaste={canWaste}
        heldCount={props.heldCount}
        setMode={setMode}
        setQuoteAsk={setQuoteAsk}
      />
      <CartBanners
        service={service}
        orderType={orderType}
        defaultOrderType={defaultOrderType}
        cart={cart}
        setCart={setCart}
        setMode={setMode}
        hallTools={props.hallTools}
        onKitchenSent={props.onKitchenSent}
        setKitchen={setKitchen}
        cashierName={session.fullName}
        currency={ctx.currency}
      />
      <CartLines
        lineCount={lineCount}
        cart={cart}
        priced={priced}
        catalog={catalog}
        ctx={ctx}
        needs={needs}
        takePlan={takePlan}
        bump={bump}
        packsByVariant={packsByVariant}
        pieces={pieces}
        sectors={settings.sectors}
        selected={selected}
        setSelected={setSelected}
        lineWarn={lineWarn}
        remove={remove}
        changeQty={changeQty}
        setMode={setMode}
      />
      <CartTotals
        cart={cart}
        setCart={setCart}
        setMode={setMode}
        totals={totals}
        ctx={ctx}
        totalMinor={totalMinor}
        planFeeMinor={planFeeMinor}
        contractSaved={contractSaved}
        taxInclusive={settings.taxInclusive}
        pharmacy={settings.pharmacy}
        foreign={foreign}
        shownRate={shownRate}
        guard={guard}
        batchWaits={batchWaits}
        warnRows={warnRows}
        warnDanger={warnDanger}
        removed={removed}
        setRemoved={setRemoved}
        lineCount={lineCount}
        heldCount={props.heldCount}
        onResume={props.onResume}
        selected={selected}
        payBlock={payBlock}
        canPay={canPay}
        startPay={startPay}
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
      reserved={reserved}
    />
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
      <SaleModePanel
        props={props}
        effectiveMode={effectiveMode}
        catalog={catalog}
        cart={cart}
        ctx={ctx}
        staff={staff}
        session={session}
        settings={settings}
        seller={seller}
        pos={pos}
        soldOnline={soldOnline}
        setSoldOnline={setSoldOnline}
        setCart={setCart}
        setMode={setMode}
        setSelected={setSelected}
        setSeller={setSeller}
        setNotice={setNotice}
        setJustAdded={setJustAdded}
        setJustSwapped={setJustSwapped}
        setJustMade={setJustMade}
        setPlanFeeMinor={setPlanFeeMinor}
        add={add}
        lineOf={lineOf}
        checkLine={checkLine}
        applyLine={applyLine}
        checkInvoice={checkInvoice}
        removeNow={removeNow}
        holdSale={holdSale}
        priced={priced}
        totalMinor={totalMinor}
        lineCount={lineCount}
        packsByVariant={packsByVariant}
        lastUnits={lastUnits}
        setLastUnits={setLastUnits}
        saleUnits={saleUnits}
        pieces={pieces}
        inCartQty={inCartQty}
        pickerAddedAt={pickerAddedAt}
        outOk={outOk}
        cartRef={cartRef}
        itemsArea={itemsArea}
        replacedLine={replacedLine}
        batchPlan={batchPlan}
        rxNeed={rxNeed}
        hasControlled={hasControlled}
        waitingOnline={waitingOnline}
        service={service}
      />
    </CashierShell>
  );
}
