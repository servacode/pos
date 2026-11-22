import type { ReactNode } from 'react';
import type { OutboxEntry } from '@serva/sync';
import { type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import type { StaffMember, StaffSession } from '../staff/staff';
import type { AdjustMode } from './AdjustPanel';
import { type ApprovalNeed, type Cart } from './cart';
import type { usePos } from '../services';
import type { HallTools } from '../hall/tools';
import type { SavedGiftVoucher } from '../customers/GiftVoucherScreen';
import { pieceWord } from './packText';

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
  /** The cart's total as priced here, told up so closing the shift can name what is still open */
  onTotal?: (totalMinor: number) => void;
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

export const SELLER_KEY = 'salesperson';
/** The unit last used for each item (the piece or a box), so the unit sheet offers it first */
export const LAST_UNIT_KEY = 'serva.lastUnit';
/** The pay screen was open: a reload of the till brings it back for the same cashier and total */
export const PAY_OPEN_KEY = 'pay-open';
/** «علّق» and «خصم» beside the pay button: an icon over a small word, 72 high like the button */
export const CART_QUICK =
  'flex min-h-18 w-16 flex-col items-center justify-center gap-1 rounded-card border border-line-control/50 bg-surface text-xs font-semibold text-ink shadow-e1 transition-colors duration-120 ease-standard hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50';

/** «قطعة» or «علبة (100 قطعة)»: the unit said on the added toast */
export function unitName(hit: BarcodeHit | null): string {
  if (!hit) return 'قطعة';
  const qty = hit.barcode.packQty / 1000;
  return `${hit.barcode.packName ?? 'علبة'} (${qty} ${pieceWord(hit.barcode.packQty)})`;
}

export const SHORTCUTS: [string, string][] = [
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

export function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** The notice over the items grid: a warning or a line of information, with an optional link or button */
export type SaleNotice = {
  tone: 'warning' | 'info';
  text: string;
  href?: string;
  linkText?: string;
  /** A button instead of a link: runs here on the till (decision 15: «أضف صنف جديد») */
  actionText?: string;
  onAction?: () => void;
};

export type PosServices = ReturnType<typeof usePos>;

/** A product just made at the till (round 39): it joins the cart once the catalog holds it */
export interface JustMade {
  variantId: string;
  name: string;
  offline: boolean;
}
