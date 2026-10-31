import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CURRENCIES } from '@serva/core/currencies';
import { convert, lineGross } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import { rateFor } from '@serva/core/sale';
import { toLatinDigits } from '@serva/core/text';
import type { OutboxEntry } from '@serva/sync';
import {
  BarcodeIcon,
  Button,
  CartIcon,
  CartLine,
  CashierShell,
  CloseIcon,
  cn,
  displayNumber,
  formatQuantity,
  ItemTile,
  KeyIcon,
  Money,
  RemoveIcon,
  AddIcon,
  DeleteIcon,
  OfferIcon,
  RetryIcon,
  SearchIcon,
  UndoIcon,
  useDigits,
  WarningIcon,
} from '@serva/ui';
import { barcodeKey, searchCatalog, type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { counted } from '../format';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { AdjustPanel, NEED_TEXT, type AdjustMode, type AdjustValue } from './AdjustPanel';
import {
  addItem,
  invoiceNeed,
  lineNeed,
  pieceCount,
  priceCart,
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

const PaymentPanel = lazy(() => import('../pay/PaymentPanel').then((m) => ({ default: m.PaymentPanel })));

export type SaleMode =
  | { kind: 'items' }
  | { kind: 'line'; lineNo: number; adjust: AdjustMode }
  | { kind: 'invoice' }
  | { kind: 'approve'; lineNo: number | null; need: ApprovalNeed }
  | { kind: 'pay' }
  | { kind: 'done' }
  | { kind: 'help' };

export interface SaleScreenProps {
  statusBar: ReactNode;
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shiftId: string;
  cart: Cart;
  setCart: (update: (cart: Cart) => Cart) => void;
  heldCount: number;
  onHold: () => void;
  onResume: () => void;
  /** The last sale's lines, for «كرّر آخر طلب» */
  lastLines: { variantId: string; barcode: string | null; qty: number }[];
  onSaved: (entry: OutboxEntry) => void;
  /** The finished sale's screen, shown in place of the items until the next sale starts */
  done: ReactNode | null;
  onNextSale: () => void;
  /** Keyboard actions that belong to the cashier app (menu, lock) */
  extraShortcuts?: (event: KeyboardEvent) => boolean;
}

const SHORTCUTS: [string, string][] = [
  ['ابحث أو امسح', 'F2 أو /'],
  ['علّق الفاتورة أو استرجعها', 'F4 أو Alt+3'],
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
  const ctx = useMemo<PricingContext>(
    () => ({ currency: settings.baseCurrency, taxInclusive: settings.taxInclusive, rates: catalog.rates }),
    [settings.baseCurrency, settings.taxInclusive, catalog.rates],
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'info'; text: string } | null>(null);
  const [removed, setRemoved] = useState<{ line: Line; index: number } | null>(null);
  const [bump, setBump] = useState<number | null>(null);
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
  const blocked = needs.size > 0 || invoiceNeeds !== null;
  const canPay = cart.lines.length > 0 && priced !== null && !blocked;

  const showDone = props.done !== null && cart.lines.length === 0;
  const effectiveMode: SaleMode = showDone && mode.kind === 'items' ? { kind: 'done' } : mode;

  // ── Adding items ────────────────────────────────────────────────────────────────────────────
  const add = useCallback(
    (item: CatalogItem, hit?: BarcodeHit | null) => {
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
      const qty = (multiplier ?? 1) * 1000;
      setMultiplier(null);
      setNotice(null);
      if (props.done) props.onNextSale();
      // From the latest cart, so scans arriving before the next render all count.
      const current = cartRef.current;
      const next = addItem(current, item, hit, qty);
      cartRef.current = next;
      setCart(() => next);
      const added = next.lines.find((l, i) => l !== current.lines[i])?.lineNo ?? null;
      setBump(added);
      if (item.unit?.allowsFraction && added !== null) {
        setSelected(added);
        setMode({ kind: 'line', lineNo: added, adjust: 'qty' });
      } else if (mode.kind === 'pay' || mode.kind === 'done' || mode.kind === 'help') {
        setMode({ kind: 'items' });
      }
    },
    [ctx, multiplier, setCart, mode.kind, props],
  );

  const scan = useCallback(
    (raw: string) => {
      const code = barcodeKey(raw);
      const hit = catalog.byBarcode.get(code);
      if (hit) add(hit.item, hit);
      else
        setNotice({
          tone: 'warning',
          text: `الباركود ${code} غير معروف على هذا الجهاز. ابحث عن الصنف باسمه.`,
        });
    },
    [catalog, add],
  );

  const keypadOpen = mode.kind === 'line' || mode.kind === 'invoice' || mode.kind === 'approve';
  // While paying, amounts are typed and confirmed with Enter: only a full barcode counts as a scan.
  useScanner({
    enabled: !keypadOpen,
    onScan: scan,
    onMultiplier: setMultiplier,
    minLength: mode.kind === 'pay' ? 8 : 3,
  });

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

  const results = useMemo(
    () => searchCatalog(catalog, query, { categoryId: category, limit: 60 }),
    [catalog, query, category],
  );

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('');
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = toLatinDigits(query.trim());
    const qty = /^(\d{1,3})\s*[*×]$/.exec(value);
    if (qty) {
      setMultiplier(Number(qty[1]));
      setQuery('');
      return;
    }
    const hit = catalog.byBarcode.get(barcodeKey(value));
    if (hit) add(hit.item, hit);
    else if (results.length === 1) add(results[0]!);
    else if (/^\d{6,}$/.test(value)) scan(value);
    else return;
    setQuery('');
  }

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

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────────
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event) => {
    if (props.extraShortcuts?.(event)) return;
    const typing = isTyping(event.target);
    if (event.key === 'Escape' && mode.kind !== 'items' && mode.kind !== 'pay') {
      setMode({ kind: 'items' });
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
      else props.onResume();
    } else if (event.key === 'F12' || (event.key === '+' && !typing)) {
      event.preventDefault();
      if (canPay) setMode({ kind: 'pay' });
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

  const cartPanel = (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <CartIcon size={20} className="text-ink-muted" />
        <span className="font-semibold text-ink">
          {lineCount === 0 ? 'فاتورة جديدة' : 'الفاتورة الحالية'}
        </span>
        <span className="flex-1" />
        {props.heldCount > 0 ? (
          <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning-ink">
            {props.heldCount === 1 ? 'فاتورة معلّقة' : `${props.heldCount} فواتير معلّقة`}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lineCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-muted">
            <BarcodeIcon size={48} />
            <span className="text-lg font-semibold text-ink">السلة فارغة</span>
            <span>امسح الباركود أو اختر صنفاً من الشبكة.</span>
          </div>
        ) : (
          <ul aria-label="أسطر الفاتورة">
            {cart.lines.map((line, i) => {
              const p = priced?.lines[i];
              const need = needs.get(line.lineNo);
              const meta = [
                line.packName ? line.packName : null,
                line.adjustment?.kind === 'price' ? 'سعر معدّل' : null,
                p && p.priced.lineDiscountMinor > 0 && line.adjustment?.kind === 'discount' ? (
                  <span key="d" className="text-info-ink">
                    خصم <Money minor={p.priced.lineDiscountMinor} currency={ctx.currency} symbol={false} />
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
                  selected={selected === line.lineNo}
                  onSelect={() => setSelected((s) => (s === line.lineNo ? null : line.lineNo))}
                >
                  {need ? (
                    <p
                      role="alert"
                      className="flex w-full items-center gap-2 text-sm font-semibold text-warning-ink"
                    >
                      <WarningIcon size={16} />
                      {NEED_TEXT[need]}
                    </p>
                  ) : null}
                  {line.weighed ? (
                    <Button
                      variant="secondary"
                      onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                    >
                      الوزن
                    </Button>
                  ) : (
                    <div className="inline-flex items-center overflow-hidden rounded-control border border-line">
                      <button
                        type="button"
                        aria-label="أنقص الكمية"
                        onClick={() => changeQty(line, -1)}
                        className="grid size-12 place-items-center hover:bg-surface-muted"
                      >
                        <RemoveIcon size={20} />
                      </button>
                      <button
                        type="button"
                        aria-label="اكتب الكمية"
                        onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'qty' })}
                        className="num min-w-10 text-center text-lg font-bold"
                      >
                        {formatQuantity(line.qty, digits)}
                      </button>
                      <button
                        type="button"
                        aria-label="زِد الكمية"
                        onClick={() => changeQty(line, 1)}
                        className="grid size-12 place-items-center hover:bg-surface-muted"
                      >
                        <AddIcon size={20} />
                      </button>
                    </div>
                  )}
                  <Button
                    variant="secondary"
                    icon={<OfferIcon size={16} />}
                    onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'percent' })}
                  >
                    خصم
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setMode({ kind: 'line', lineNo: line.lineNo, adjust: 'price' })}
                  >
                    السعر
                  </Button>
                  {need ? (
                    <Button
                      variant="secondary"
                      icon={<KeyIcon size={16} />}
                      onClick={() => setMode({ kind: 'approve', lineNo: line.lineNo, need })}
                    >
                      رمز المدير
                    </Button>
                  ) : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label="احذف السطر"
                    onClick={() => remove(line.lineNo)}
                    className="grid size-12 place-items-center rounded-control text-ink-muted hover:bg-danger-soft hover:text-danger-ink"
                  >
                    <DeleteIcon size={20} />
                  </button>
                </CartLine>
              );
            })}
          </ul>
        )}
      </div>
      {removed ? (
        <div role="status" className="flex items-center gap-3 bg-ink px-4 py-2 text-sm text-canvas">
          <span className="flex-1 truncate">حُذف «{removed.line.name}»</span>
          <button
            type="button"
            onClick={() => {
              setCart((c) => restoreLine(c, removed.line, removed.index));
              setRemoved(null);
            }}
            className="flex min-h-12 items-center gap-1 px-2 font-bold text-brand-soft"
          >
            <UndoIcon size={16} />
            تراجع
          </button>
        </div>
      ) : null}
      <div className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface-total p-4">
        {totals && totals.discountMinor > 0 ? (
          <dl className="flex flex-col gap-0.5 text-sm">
            <div className="flex justify-between text-ink-muted">
              <dt>المجموع قبل الخصم</dt>
              <dd>
                <Money minor={totals.grossMinor} currency={ctx.currency} />
              </dd>
            </div>
            <div className="flex justify-between font-semibold text-info-ink">
              <dt>الخصم · وفّر الزبون</dt>
              <dd>
                <Money minor={totals.discountMinor} currency={ctx.currency} />
              </dd>
            </div>
          </dl>
        ) : null}
        {totals && !settings.taxInclusive && totals.taxMinor > 0 ? (
          <div className="flex justify-between text-sm text-ink-muted">
            <span>الضريبة</span>
            <Money minor={totals.taxMinor} currency={ctx.currency} />
          </div>
        ) : null}
        {invoiceNeeds ? (
          <div role="alert" className="flex items-center gap-2 text-sm font-semibold text-warning-ink">
            <WarningIcon size={16} />
            <span className="flex-1">{NEED_TEXT[invoiceNeeds]}</span>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setMode({ kind: 'approve', lineNo: null, need: invoiceNeeds })}
            >
              رمز المدير
            </Button>
          </div>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col pb-1">
            <span className="font-semibold text-ink-muted">المطلوب</span>
            <span className="text-xs text-ink-muted">
              {lineCount === 0
                ? 'لا أسطر بعد'
                : `${counted(lineCount, ['سطر واحد', 'سطران', 'أسطر', 'سطراً'], digits)} · ${counted(pieceCount(cart), ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'], digits)}`}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <output aria-live="polite" aria-label="المطلوب" className="text-total font-bold text-ink">
              <Money minor={totalMinor} currency={ctx.currency} />
            </output>
            {foreign ? (
              <span className="text-sm text-ink-muted">
                ≈{' '}
                <Money
                  minor={convert(
                    totalMinor,
                    ctx.currency,
                    foreign,
                    rateFor(ctx.rates, foreign, ctx.currency),
                  )}
                  currency={foreign}
                />{' '}
                · سعر الصرف <bdi className="num">{displayNumber(catalog.rates[0]!.rate, digits)}</bdi>
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => (lineCount > 0 ? props.onHold() : props.onResume())}
            disabled={lineCount === 0 && props.heldCount === 0}
          >
            {lineCount === 0 && props.heldCount > 0 ? 'استرجع المعلّقة' : 'علّق'}
          </Button>
          <Button
            variant="secondary"
            icon={<OfferIcon size={16} />}
            onClick={() => setMode({ kind: 'invoice' })}
            disabled={lineCount === 0}
          >
            خصم
          </Button>
        </div>
        <Button size="pay" onClick={() => setMode({ kind: 'pay' })} disabled={!canPay}>
          <span>ادفع</span>
          <Money minor={totalMinor} currency={ctx.currency} />
        </Button>
      </div>
    </>
  );

  return (
    <CashierShell statusBar={props.statusBar} cart={cartPanel} mainClassName="gap-3.5 p-4 xl:px-6">
      {effectiveMode.kind === 'pay' && priced ? (
        <Suspense fallback={null}>
          <PaymentPanel
            cart={cart}
            ctx={ctx}
            totalMinor={totalMinor}
            catalog={catalog}
            shiftId={props.shiftId}
            cashierId={session.userId}
            onBack={() => setMode({ kind: 'items' })}
            onCompleted={(entry) => {
              setMode({ kind: 'items' });
              setSelected(null);
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
          subtitle={`على ${counted(lineCount, ['سطر واحد', 'سطرين', 'أسطر', 'سطراً'], digits)}`}
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
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold text-ink">موافقة على الخصم</h2>
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
        </div>
      ) : effectiveMode.kind === 'help' ? (
        <section
          aria-label="دليل الاختصارات"
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-ink">دليل الاختصارات</h2>
            <Button variant="secondary" icon={<CloseIcon />} onClick={() => setMode({ kind: 'items' })}>
              أغلق
            </Button>
          </div>
          <table className="w-full text-start">
            <thead>
              <tr className="text-sm text-ink-muted">
                <th className="py-2 text-start font-semibold">الفعل</th>
                <th className="py-2 text-start font-semibold">المفتاح</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map(([action, key]) => (
                <tr key={action} className="border-t border-line">
                  <td className="py-3">{action}</td>
                  <td className="py-3">
                    <kbd
                      dir="ltr"
                      className="rounded-small border border-line bg-surface-muted px-2 py-1 font-sans text-sm font-semibold"
                    >
                      {key}
                    </kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <>
          <div className="flex shrink-0 gap-3">
            <label className="flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-line-control bg-surface px-4 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
              <SearchIcon size={20} className="text-ink-muted" />
              <span className="sr-only">ابحث أو امسح الباركود</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
                placeholder="ابحث باسم الصنف أو امسح الباركود"
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
              />
              {multiplier ? (
                <span
                  className="num rounded-full bg-brand-soft px-3 py-1 font-bold text-brand-ink"
                  aria-label={`الكمية التالية ${multiplier}`}
                >
                  ×{displayNumber(String(multiplier), digits)}
                </span>
              ) : null}
              {query ? (
                <button
                  type="button"
                  aria-label="امسح البحث"
                  onClick={() => setQuery('')}
                  className="grid size-12 place-items-center rounded-small text-ink-muted hover:bg-surface-muted"
                >
                  <CloseIcon size={16} />
                </button>
              ) : (
                <span className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-ink-muted lg:flex">
                  <BarcodeIcon size={16} />
                  القارئ جاهز
                </span>
              )}
            </label>
            {props.lastLines.length > 0 ? (
              <Button
                variant="secondary"
                icon={<RetryIcon size={16} />}
                onClick={() => {
                  for (const l of props.lastLines) {
                    const hit = l.barcode ? catalog.byBarcode.get(l.barcode) : undefined;
                    const item = hit?.item ?? catalog.byVariant.get(l.variantId);
                    if (item) setCart((c) => addItem(c, item, hit ?? null, l.qty));
                  }
                  if (props.done) props.onNextSale();
                }}
              >
                كرّر آخر طلب
              </Button>
            ) : null}
          </div>
          {notice ? (
            <div
              role="alert"
              className={cn(
                'flex items-center gap-3 rounded-control px-4 py-3 font-semibold',
                notice.tone === 'warning' ? 'bg-warning-soft text-warning-ink' : 'bg-info-soft text-info-ink',
              )}
            >
              <WarningIcon size={20} />
              <span className="flex-1">{notice.text}</span>
              <button
                type="button"
                aria-label="أخفِ التنبيه"
                onClick={() => setNotice(null)}
                className="grid size-12 place-items-center rounded-small"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          ) : null}
          {catalog.categories.length > 0 ? (
            <div role="group" aria-label="التصنيفات" className="flex shrink-0 gap-2 overflow-x-auto pb-1">
              {[{ id: null, name: 'الكل' }, ...catalog.categories].map((c) => {
                const on = !query && category === c.id;
                return (
                  <button
                    key={c.id ?? 'all'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setCategory(c.id);
                      setQuery('');
                    }}
                    className={cn(
                      'min-h-12 shrink-0 rounded-full border px-4 font-semibold whitespace-nowrap',
                      on
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink hover:border-line-control',
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-ink-muted">
              <span className="text-lg font-semibold text-ink">
                {catalog.items.length === 0 ? 'لا أصناف على هذا الجهاز بعد' : 'لا يوجد صنف بهذا الاسم'}
              </span>
              <span>
                {catalog.items.length === 0
                  ? 'تصل الأصناف مع أول اتصال بالإنترنت.'
                  : 'جرّب كلمة أقصر، أو امسح الباركود.'}
              </span>
            </div>
          ) : (
            <ul
              aria-label="الأصناف"
              className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-3"
            >
              {results.map((item) => (
                <li key={item.variantId}>
                  <ItemTile
                    name={item.name}
                    priceMinor={item.price.priceMinor}
                    currency={item.price.currency}
                    weighed={item.unit?.allowsFraction ?? false}
                    selected={cart.lines.some((l) => l.variantId === item.variantId)}
                    onSelect={() => add(item)}
                    className="w-full"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </CashierShell>
  );
}
