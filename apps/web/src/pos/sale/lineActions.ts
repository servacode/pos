import type { Approval } from '@serva/core/contracts/documents';
import type { Catalog } from '../catalog';
import type { AdjustValue } from './AdjustPanel';
import {
  invoiceNeed,
  lineNeed,
  priceCart,
  removeLine,
  unitPriceOf,
  updateLine,
  type ApprovalNeed,
  type ApprovalRules,
  type Cart,
  type CartLine as Line,
  type PricingContext,
} from './cart';
import type { SaleMode, SaleScreenProps } from './saleTypes';

export interface LineActionsArgs {
  cart: Cart;
  setCart: SaleScreenProps['setCart'];
  setSelected: (lineNo: number | null) => void;
  setMode: (mode: SaleMode) => void;
  setRemoved: (removed: { line: Line; index: number } | null) => void;
  mode: SaleMode;
  hallTools: SaleScreenProps['hallTools'];
  catalog: Catalog;
  ctx: PricingContext;
  rules: ApprovalRules;
}

/** Changes to a line or to the whole invoice: remove, quantity, the discount or price checks, and applying them */
export function lineActions({
  cart,
  setCart,
  setSelected,
  setMode,
  setRemoved,
  mode,
  hallTools,
  catalog,
  ctx,
  rules,
}: LineActionsArgs) {
  function remove(lineNo: number) {
    const index = cart.lines.findIndex((l) => l.lineNo === lineNo);
    if (index < 0) return;
    // A line the kitchen already has is cancelled on the server, with a reason and a manager's code
    if (hallTools && (cart.sent?.[lineNo] ?? 0) > 0 && (cart.hall?.lineIds?.[lineNo]?.length ?? 0) > 0) {
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
  return { remove, removeNow, changeQty, lineOf, checkLine, applyLine, checkInvoice };
}
