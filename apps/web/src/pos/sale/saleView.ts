import type { Catalog } from '../catalog';
import type { StaffSession } from '../staff/staff';
import type { batchGuard } from './batches';
import { blockText } from './batches';
import { showsWaste } from './waste';
import { NEED_TEXT } from './AdjustPanel';
import type { missingSerials } from './cart';
import {
  pieceCount,
  type ApprovalNeed,
  type Cart,
  type CartLine as Line,
  type PricedCart,
  type PricingContext,
} from './cart';
import { isUnfedService } from './serviceFee';
import type { SaleMode } from './saleTypes';

export interface SaleViewArgs {
  catalog: Catalog;
  settings: NonNullable<Catalog['settings']>;
  ctx: PricingContext;
  cart: Cart;
  priced: PricedCart | null;
  session: StaffSession;
  mode: SaleMode;
  hasWholesale: boolean;
  waitingOnline: readonly unknown[];
  heldCount: number;
  defaultOrderType: 'dine_in' | 'takeaway';
  guard: ReturnType<typeof batchGuard>;
  batchWaits: boolean;
  unnumbered: ReturnType<typeof missingSerials>;
  needs: Map<number, ApprovalNeed>;
  invoiceNeeds: ApprovalNeed | null;
  canPay: boolean;
  setPhoneView: (view: 'items' | 'cart') => void;
  setSelected: (lineNo: number | null) => void;
  setMode: (mode: SaleMode) => void;
}

/** What the cart panel shows and why «ادفع» may be greyed, worked out once per render */
export function saleView({
  catalog,
  settings,
  ctx,
  cart,
  priced,
  session,
  mode,
  hasWholesale,
  waitingOnline,
  heldCount,
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
}: SaleViewArgs) {
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
    heldCount > 0;
  const orderType = cart.service?.orderType ?? defaultOrderType;

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
      // The screen may be gone by then (a test torn down, a page left): nothing to scroll
      globalThis.document
        ?.getElementById(`cart-line-${lineNo}`)
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
  return {
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
  };
}
