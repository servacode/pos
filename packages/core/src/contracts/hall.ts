import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * The hall and the kitchen on the server (03 › المطاعم: الصالة، المطبخ، وضع النادل). A table's open
 * order is an operational document, not a financial one: it holds lines with their choices, a note
 * and a seat, each line moving new → sent → preparing → ready → served (or cancelled). Waiter
 * screens, tills and the kitchen screen all work on the same order through commands, each applied
 * in one transaction under the order's row lock, so two people adding to one table never overwrite
 * each other; every command moves the order's `version` and leaves an event.
 *
 *   GET  /v1/device/hall      → HallResponse     the branch's open orders (till, waiter)
 *   POST /v1/device/hall      hallCommand → { order }   one command on an order (null once closed)
 *   GET  /v1/device/kitchen   → KitchenResponse  tickets still to prepare, by section
 *   POST /v1/device/kitchen   kitchenCommand → KitchenResponse   a line's progress
 *   GET  /v1/device/menu      → HallMenuResponse the menu and the staff who take orders
 *   GET  /v1/hall/cancellations?from&to → CancellationsResponse   owner's report (signed-in)
 *
 * Device routes carry `Authorization: Device <token>`; the waiter and the cashier name the person
 * acting (`userId`, who must hold `hall.order` or `sale.create` in the device's branch). The
 * waiter does not take payment: only a till closes an order as paid.
 */

export const LINE_STATUSES = ['new', 'sent', 'preparing', 'ready', 'served', 'cancelled'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const LINE_STATUS_TEXT: Record<LineStatus, string> = {
  new: 'لم يُرسل',
  sent: 'جديد',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  served: 'قُدِّم',
  cancelled: 'ملغى',
};

export const ORDER_STATUSES = ['open', 'bill_requested', 'closed'] as const;
export type HallOrderStatus = (typeof ORDER_STATUSES)[number];

/** The section a product without a category goes to. */
export const DEFAULT_SECTION = 'عام';

/** What the kitchen may do to a line, from where it stands. */
const KITCHEN_MOVES: Record<LineStatus, readonly LineStatus[]> = {
  new: [],
  sent: ['preparing', 'ready'],
  preparing: ['ready', 'sent'],
  ready: ['preparing'],
  served: [],
  cancelled: [],
};

export function kitchenMayMove(from: LineStatus, to: LineStatus): boolean {
  return KITCHEN_MOVES[from].includes(to);
}

/** A line the kitchen has started: cancelling it later is cancelling after preparation. */
export function isPrepared(status: LineStatus): boolean {
  return status === 'preparing' || status === 'ready';
}

/** Statuses a line can be cancelled from, with the manager's approval and a reason. */
export const CANCELLABLE_AFTER_SEND: readonly LineStatus[] = ['sent', 'preparing', 'ready'];

export const hallChoiceSchema = z.object({
  group: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(60),
  priceMinor: z.int().nonnegative(),
});
export type HallChoice = z.output<typeof hallChoiceSchema>;

export const hallLineInput = z.object({
  productId: uuidSchema,
  variantId: uuidSchema,
  name: z.string().trim().min(1, 'اكتب اسم الصنف').max(160),
  qty: z.int().min(1).max(99),
  choices: z.array(hallChoiceSchema).max(20).default([]),
  note: z.string().trim().max(200).nullable().optional(),
  seat: z.int().min(1).max(30).nullable().optional(),
});
export type HallLineInput = z.input<typeof hallLineInput>;

const actor = { userId: uuidSchema };

export const hallCommand = z.discriminatedUnion('type', [
  /** Opens the table's order, or returns the one already open there */
  z.object({
    type: z.literal('open'),
    ...actor,
    table: z.string().trim().min(1).max(40),
    guests: z.int().min(1).max(99).nullable().optional(),
  }),
  z.object({
    type: z.literal('add'),
    ...actor,
    orderId: uuidSchema,
    lines: z.array(hallLineInput).min(1).max(60),
  }),
  /** Deleting a line is free until it is sent */
  z.object({ type: z.literal('remove'), ...actor, orderId: uuidSchema, lineId: uuidSchema }),
  /** «أرسل للمطبخ»: every new line goes to its section's ticket */
  z.object({ type: z.literal('send'), ...actor, orderId: uuidSchema }),
  /** «كشف حساب»: the table now waits for the bill */
  z.object({ type: z.literal('bill'), ...actor, orderId: uuidSchema }),
  /** The waiter takes a ready line to the table */
  z.object({
    type: z.literal('serve'),
    ...actor,
    orderId: uuidSchema,
    lineIds: z.array(uuidSchema).min(1).max(60),
  }),
  /** After the kitchen: a reason and a manager's code */
  z.object({
    type: z.literal('cancel'),
    ...actor,
    orderId: uuidSchema,
    lineId: uuidSchema,
    reason: z.string().trim().min(2, 'اكتب سبب الإلغاء').max(200),
    approverId: uuidSchema,
    approverPin: z.string().regex(/^\d{4,6}$/, 'رمز المدير 6 أرقام'),
  }),
  /** The till charged the table (or an empty order is dropped); the waiter cannot */
  z.object({
    type: z.literal('close'),
    ...actor,
    orderId: uuidSchema,
    reason: z.enum(['paid', 'empty']),
    /** The sale's document number, for «paid» */
    ref: z.string().trim().max(60).nullable().optional(),
  }),
]);
export type HallCommand = z.input<typeof hallCommand>;
export type HallCommandData = z.output<typeof hallCommand>;

export const kitchenCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    lineIds: z.array(uuidSchema).min(1).max(60),
    status: z.enum(['sent', 'preparing', 'ready']),
  }),
  /** The section has seen a cancelled line */
  z.object({ type: z.literal('ack'), lineIds: z.array(uuidSchema).min(1).max(60) }),
]);
export type KitchenCommand = z.input<typeof kitchenCommand>;
export type KitchenCommandData = z.output<typeof kitchenCommand>;

export const cancellationsQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export interface HallLine {
  id: string;
  productId: string;
  variantId: string;
  name: string;
  qty: number;
  choices: HallChoice[];
  note: string | null;
  seat: number | null;
  section: string;
  status: LineStatus;
  ticketId: string | null;
  addedByName: string | null;
  sentAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  cancelReason: string | null;
  cancelledAfterSend: boolean;
}

export interface HallOrder {
  id: string;
  table: string;
  guests: number | null;
  status: Exclude<HallOrderStatus, 'closed'>;
  openedByName: string | null;
  openedAt: string;
  billRequestedAt: string | null;
  lines: HallLine[];
  version: number;
}

/** The order after the command; null when the command closed it */
export interface HallCommandResponse {
  order: HallOrder | null;
}

export interface HallResponse {
  orders: HallOrder[];
  /** The hall's tables from the store's service settings */
  tables: string[];
  serverTime: string;
}

export interface KitchenTicketLine {
  id: string;
  name: string;
  qty: number;
  choices: string[];
  note: string | null;
  seat: number | null;
  status: LineStatus;
  readyAt: string | null;
  cancelReason: string | null;
}

export interface KitchenTicket {
  id: string;
  seq: number;
  section: string;
  table: string;
  /** «إضافة» for the second and later tickets of one order */
  kind: 'new' | 'add';
  createdAt: string;
  lines: KitchenTicketLine[];
}

export interface KitchenResponse {
  tickets: KitchenTicket[];
  sections: string[];
  serverTime: string;
}

export interface HallMenuItem {
  productId: string;
  variantId: string;
  name: string;
  category: string;
  section: string;
  priceMinor: number;
  modifiers: {
    name: string;
    multiple: boolean;
    required: boolean;
    options: { name: string; priceMinor: number }[];
  }[];
}

export interface HallMenuResponse {
  currency: string;
  items: HallMenuItem[];
  /** Who can sign in on this device to take orders */
  staff: { id: string; fullName: string; pinLength: 4 | 6 }[];
  /** Managers whose code approves a cancellation after the kitchen */
  approvers: { id: string; fullName: string }[];
  tables: string[];
}

export interface CancellationRow {
  at: string;
  table: string;
  item: string;
  qty: number;
  reason: string;
  /** before_prep: sent but not started; after_prep: started or ready */
  stage: 'before_prep' | 'after_prep';
  waiterName: string | null;
  approverName: string | null;
}

export interface CancellationsResponse {
  items: CancellationRow[];
  from: string;
  to: string;
}
