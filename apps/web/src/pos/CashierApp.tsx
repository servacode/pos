import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HallOrder } from '@serva/core';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { OutboxEntry, SyncDocument } from '@serva/sync';
import {
  Button,
  CashIcon,
  CashierShell,
  EmptyState,
  GiftIcon,
  IconButton,
  LockIcon,
  LogoutIcon,
  Menu,
  MenuItem,
  MenuSeparator,
  MoreIcon,
  PrintIcon,
  ScissorsIcon,
  SettingsIcon,
  TransferIcon,
  UndoIcon,
  useDigits,
  WarningIcon,
} from '@serva/ui';
import type { Catalog } from './catalog';
import { clockText } from './format';
import { PrintableReceipt, type PaperWidth, type ReceiptData } from './receipt/Receipt';
import { printJob as escposJob } from './print/escpos';
import { receiptLines } from './print/lines';
import { DEFAULT_PRINTER, PRINTER_KEY, PrinterScreen, type PrinterSetting } from './print/PrinterScreen';
import { renderLines } from './print/render';
import { sendToPrinter } from './print/usb';
import { SaleDone } from './receipt/SaleDone';
import { deliverTicket } from './alterations/api';
import { addItem, EMPTY_CART, type Cart } from './sale/cart';
import { cancelSentLines, flushPendingCancels } from './hall/cancelSent';
import { cartFromOrder, lineIdsOf } from './hall/hallCart';
import type { HallTools } from './hall/tools';
import { useServerHall } from './hall/useServerHall';
import { SaleScreen } from './sale/SaleScreen';
import { PosProvider, usePos } from './services';
import { validated } from './validate';
import { voucherBalancesAfter } from './pay/vouchers';
import { readShift, type OpenShift } from './shift/shift';
import { staffRoster, type StaffSession } from './staff/staff';
import { SubscriptionChip, useTillSubscription } from '../layout/subscription-banner';
import { StatusBar, type OutboxStatus } from './StatusBar';
import { useIdle } from './useIdle';

const ShiftOpenScreen = lazy(() =>
  import('./shift/ShiftScreens').then((m) => ({ default: m.ShiftOpenScreen })),
);
const ShiftCloseScreen = lazy(() =>
  import('./shift/ShiftScreens').then((m) => ({ default: m.ShiftCloseScreen })),
);
const ReturnScreen = lazy(() => import('./return/ReturnScreen').then((m) => ({ default: m.ReturnScreen })));
const ReceiptScreen = lazy(() =>
  import('./customers/ReceiptScreen').then((m) => ({ default: m.ReceiptScreen })),
);
const GiftVoucherScreen = lazy(() =>
  import('./customers/GiftVoucherScreen').then((m) => ({ default: m.GiftVoucherScreen })),
);
const AlterationsScreen = lazy(() =>
  import('./alterations/AlterationsScreen').then((m) => ({ default: m.AlterationsScreen })),
);
const CashMovementScreen = lazy(() =>
  import('./shift/ShiftScreens').then((m) => ({ default: m.CashMovementScreen })),
);

/** Minutes without a touch or a key before the device signs the cashier out (09 › tenant_settings). */
export const DEFAULT_IDLE_MINUTES = 5;

/** Whether the document took cash into the drawer: then the drawer opens after printing */
function paidInCash(data: ReceiptData): boolean {
  const payload = data.doc.payload as {
    payments?: { method: string }[];
    method?: string;
    refunds?: { method: string }[];
  };
  if (data.kind === 'receipt' || data.kind === 'gift') return payload.method === 'cash';
  if (data.kind === 'return') return (payload.refunds ?? []).some((r) => r.method === 'cash');
  return (payload.payments ?? []).some((p) => p.method === 'cash');
}

const HELD_KEY = 'heldCarts';
const HALL_CLOSE_KEY = 'hallPendingClose';

/** A table paid at this till whose order the server has not been told to close yet */
interface PendingHallClose {
  orderId: string;
  userId: string;
  ref: string;
  /** A part of a split bill (items, or one equal share) rather than the whole table */
  part?: { lineIds: string[] } | { equal: { parts: number } };
}
const LAST_SALE_KEY = 'lastSale';
const PAPER_KEY = 'paperWidth';
/** The legacy per-cashier key (a cart kept only when the screen was locked); read once, then dropped */
const cartKey = (userId: string) => `cart:${userId}`;
/** The cart in progress on this device, written on every change so a refresh or a power cut loses nothing */
const CURRENT_CART_KEY = 'currentCart';

interface SavedCurrentCart {
  userId: string;
  cart: Cart;
}

interface LastSale {
  doc: Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;
  cashierName: string;
}

type View = 'sale' | 'close' | 'cash' | 'return' | 'receipt' | 'gift' | 'alterations' | 'printer';

export interface CashierAppProps {
  session: StaffSession;
  catalog: Catalog;
  persisted: boolean | null;
  online: boolean;
  outbox: OutboxStatus | null;
  onSignOut: () => void;
}

/**
 * Everything after the sign-in: the shift (open, sale, drawer movements, close), the receipt and
 * its reprint, held carts, and the sign-out when the device sits idle. Loaded after the code pad,
 * so the first screen stays small.
 */
export function CashierApp(props: CashierAppProps) {
  const outer = usePos();
  const pos = useMemo(() => ({ ...outer, save: validated(outer.save) }), [outer]);
  return (
    <PosProvider services={pos}>
      <CashierScreens {...props} />
    </PosProvider>
  );
}

function CashierScreens({ session, catalog, persisted, online, outbox, onSignOut }: CashierAppProps) {
  const pos = usePos();
  const digits = useDigits();
  const tillSubscription = useTillSubscription(pos.device.token);
  const notice = <SubscriptionChip subscription={tillSubscription} />;
  const settings = catalog.settings;
  const staff = useMemo(
    () => staffRoster(catalog.staff, pos.device.branchCode),
    [catalog.staff, pos.device.branchCode],
  );
  const [shift, setShift] = useState<OpenShift | null | undefined>(undefined);
  const [view, setView] = useState<View>('sale');
  const [cart, setCartState] = useState<Cart>(EMPTY_CART);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const [held, setHeld] = useState<Cart[]>([]);
  // The cart is written to the device only after the saved one was read back (an empty cart at start must not erase it)
  const [cartRestored, setCartRestored] = useState(false);
  // Writes to the cart key run one after another, so a late write never lands after a clear
  const cartWrites = useRef<Promise<unknown>>(Promise.resolve());
  const writeCart = useCallback((job: () => Promise<unknown>) => {
    cartWrites.current = cartWrites.current.then(job, job).catch(() => undefined);
  }, []);
  const staffRef = useRef<{ id: string; fullName: string }[]>([]);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [done, setDone] = useState<ReceiptData | null>(null);
  const [paper, setPaper] = useState<PaperWidth>(80);
  const [printJob, setPrintJob] = useState<{ data: ReceiptData; copy: boolean } | null>(null);
  const [printer, setPrinter] = useState<PrinterSetting>(DEFAULT_PRINTER);

  staffRef.current = staff;
  const shiftMode = settings?.shiftMode ?? null;
  useEffect(() => {
    if (!shiftMode) return;
    let alive = true;
    void Promise.all([
      readShift(pos.local, shiftMode, session.userId),
      pos.local.get<SavedCurrentCart>(CURRENT_CART_KEY),
      pos.local.get<Cart[]>(HELD_KEY),
      pos.local.get<LastSale>(LAST_SALE_KEY),
      pos.local.get<PaperWidth>(PAPER_KEY),
      pos.local.get<PrinterSetting>(PRINTER_KEY),
    ]).then(async ([openShift, saved, heldCarts, last, width, printerSetting]) => {
      if (!alive) return;
      setShift(openShift);
      let nextHeld = heldCarts ?? [];
      // A cart kept by the old lock (one per cashier) is read once and moved to the new place
      const legacy = await pos.local.get<Cart>(cartKey(session.userId));
      if (legacy) void pos.local.remove(cartKey(session.userId));
      const mine = saved && saved.userId === session.userId ? saved.cart : null;
      if (!alive) return;
      if (mine && mine.lines.length > 0) {
        setCartState(mine);
      } else if (legacy && legacy.lines.length > 0) {
        setCartState(legacy);
      } else if (saved && saved.userId !== session.userId && saved.cart.lines.length > 0) {
        // Another cashier's unfinished cart: kept, offered with the held ones, never lost
        const who = staffRef.current.find((m) => m.id === saved.userId)?.fullName;
        nextHeld = [
          ...nextHeld,
          { ...saved.cart, held: { name: who ? `فاتورة ${who}` : 'فاتورة غير مكتملة', at: Date.now() } },
        ];
        void pos.local.set(HELD_KEY, nextHeld);
        void pos.local.remove(CURRENT_CART_KEY);
      }
      setHeld(nextHeld);
      setCartRestored(true);
      setLastSale(last);
      if (width) setPaper(width);
      if (printerSetting) setPrinter(printerSetting);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, shiftMode, session.userId]);

  const setCart = useCallback((update: (cart: Cart) => Cart) => setCartState(update), []);

  // The cart in progress is kept on the device on every change and dropped once it is empty (sold, held, cleared)
  useEffect(() => {
    if (!cartRestored) return;
    if (cart.lines.length > 0) {
      writeCart(() => pos.local.set(CURRENT_CART_KEY, { userId: session.userId, cart }));
    } else {
      writeCart(() => pos.local.remove(CURRENT_CART_KEY));
    }
  }, [cart, cartRestored, pos.local, session.userId, writeCart]);

  // 03 › وضع النادل: online, the table board also shows the orders on the server (a waiter's too)
  const hallTables = settings?.service?.tables ?? [];
  const serverHall = useServerHall({
    enabled: online && hallTables.length > 0,
    token: pos.device.token,
    fetchFn: pos.fetch,
  });

  // A table charged while the server could not be reached is closed there once it can (looked at on every read that gets an answer)
  useEffect(() => {
    const api = serverHall.api;
    if (!api || !serverHall.reachable) return;
    let alive = true;
    // Lines cancelled at this till while it was offline reach the kitchen screen now
    void flushPendingCancels(api, pos.local);
    void pos.local.get<PendingHallClose[]>(HALL_CLOSE_KEY).then(async (pending) => {
      if (!pending || pending.length === 0) return;
      const left: PendingHallClose[] = [];
      for (const item of pending) {
        const answer = await api.command(
          item.part
            ? {
                type: 'part',
                userId: item.userId,
                orderId: item.orderId,
                ref: item.ref,
                ...('lineIds' in item.part ? { lineIds: item.part.lineIds } : { equal: item.part.equal }),
              }
            : { type: 'close', userId: item.userId, orderId: item.orderId, reason: 'paid', ref: item.ref },
        );
        // A refusal (already closed, unknown order) will not change: drop it; no answer: keep it
        if (answer.kind === 'network') left.push(item);
      }
      if (alive) await pos.local.set(HALL_CLOSE_KEY, left);
    });
    return () => {
      alive = false;
    };
  }, [serverHall.api, serverHall.reachable, serverHall.orders, pos.local]);

  /** Tables with an order on the server and none on this till: shown on the board, opened on a tap */
  const serverOnly = useMemo(() => {
    const mine = new Set(held.flatMap((c) => (c.service?.table ? [c.service.table] : [])));
    if (cart.service?.table && cart.lines.length > 0) mine.add(cart.service.table);
    return serverHall.orders
      .filter((o) => !mine.has(o.table))
      .map((o) => cartFromOrder(o, catalog).cart)
      .filter((c) => c.lines.length > 0);
  }, [serverHall.orders, held, cart, catalog]);

  /** Signs out; an unfinished cart is already on the device (written on every change) for the next sign-in. */
  const lock = useCallback(() => {
    const current = cartRef.current;
    writeCart(() =>
      current.lines.length > 0
        ? pos.local.set(CURRENT_CART_KEY, { userId: session.userId, cart: current })
        : Promise.resolve(),
    );
    void cartWrites.current.finally(onSignOut);
  }, [pos.local, session.userId, onSignOut, writeCart]);

  const idleMinutes = settings?.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  useIdle(idleMinutes * 60_000, lock);

  // Print once the receipt is in the page; the portal stays until the next one. A USB thermal
  // printer takes the receipt as an image with no dialog; if it fails, the dialog opens instead.
  useEffect(() => {
    if (!printJob) return;
    let cancelled = false;
    const dialog = () => {
      try {
        window.print();
      } catch {
        // No printer dialog in this environment: the receipt stays on screen.
      }
    };
    const timer = setTimeout(() => {
      if (printer.mode !== 'usb') return dialog();
      const image = renderLines(receiptLines(printJob.data, printJob.copy), paper);
      if (!image) return dialog();
      const tookCash = paidInCash(printJob.data);
      void sendToPrinter(escposJob(image.bits, image.width, image.height, printer.drawer && tookCash)).then(
        (ok) => {
          if (!ok && !cancelled) dialog();
        },
      );
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [printJob, printer, paper]);

  if (!settings) {
    return (
      <CashierShell
        statusBar={
          <StatusBar
            device={pos.device}
            persisted={persisted}
            online={online}
            outbox={outbox}
            notice={notice}
          />
        }
        mainClassName="grid place-items-center p-6"
      >
        <EmptyState
          icon={WarningIcon}
          title="إعدادات المتجر لم تصل إلى هذا الجهاز بعد"
          description="تصل مع أول اتصال بالإنترنت، ثم يعمل البيع دون إنترنت."
          action={<Button onClick={onSignOut}>ارجع لشاشة الدخول</Button>}
        />
      </CashierShell>
    );
  }

  const receiptData = (doc: LastSale['doc'], cashierName: string): ReceiptData => ({
    doc,
    settings,
    branch: catalog.staff.branches.find((b) => b.code === pos.device.branchCode) ?? null,
    storeName: pos.device.storeName,
    branchName: pos.device.branchName,
    deviceName: pos.device.deviceName,
    cashierName,
    sellerName: sellerOf(doc),
  });

  /** The salesperson of a sale, when it is named */
  function sellerOf(doc: LastSale['doc']): string | null {
    const id = (doc.payload as { salespersonId?: string | null }).salespersonId;
    return (id && staff.find((m) => m.id === id)?.fullName) || null;
  }

  function saved(entry: OutboxEntry) {
    const last: LastSale = {
      doc: {
        id: entry.doc.id,
        number: entry.doc.number,
        deviceTime: entry.doc.deviceTime,
        payload: entry.doc.payload,
      },
      cashierName: session.fullName,
    };
    setLastSale(last);
    void pos.local.set(LAST_SALE_KEY, last);
    closeHallOrder(cartRef.current, entry.doc.number || entry.doc.id);
    // A sale that delivers an alteration ticket: the ticket turns delivered now that its fee is sold
    const delivering = cartRef.current.alteration;
    if (delivering && pos.device.token) void deliverTicket(delivering, pos.device.token, pos.fetch);
    // The sale is in the outbox: the kept cart goes now, so a refresh cannot bring it back as a second sale
    writeCart(() => pos.local.remove(CURRENT_CART_KEY));
    setCartState(EMPTY_CART);
    const data = receiptData(last.doc, session.fullName);
    // A sale paid with a voucher prints what is left on it, counted once the sale is in the outbox
    const paidByVoucher = (last.doc.payload as unknown as SalePayload).payments?.some(
      (p) => p.method === 'voucher',
    );
    if (!paidByVoucher) {
      setDone(data);
      setPrintJob({ data, copy: false });
      return;
    }
    void voucherBalancesAfter(pos.store, catalog.vouchers, last.doc).then((vouchersAfter) => {
      const withBalance = { ...data, vouchersAfter };
      setDone(withBalance);
      setPrintJob({ data: withBalance, copy: false });
    });
  }

  /** Puts the cart aside under a name (the customer's, when attached); several can wait together. */
  function hold(name?: string) {
    if (cart.lines.length === 0) return;
    const label = (name ?? '').trim() || cart.customer?.name || cart.onlineOrder?.customerName || '';
    const next = [...held, { ...cart, held: { name: label, at: Date.now() } }];
    setHeld(next);
    void pos.local.set(HELD_KEY, next);
    setCartState(EMPTY_CART);
    setDone(null);
  }

  /** Brings a held cart back (the last one when no index is given); a cart being taken is held first. */
  function resume(index: number = held.length - 1) {
    const picked = held[index];
    if (!picked) return;
    const back: Cart = { ...picked };
    delete back.held;
    const rest = held.filter((_, i) => i !== index);
    const next =
      cart.lines.length > 0
        ? [...rest, { ...cart, held: { name: cart.customer?.name ?? '', at: Date.now() } }]
        : rest;
    setCartState(back);
    setHeld(next);
    void pos.local.set(HELD_KEY, next);
    setDone(null);
  }

  /** Drops a held cart the cashier no longer needs. */
  function discardHeld(index: number) {
    const next = held.filter((_, i) => i !== index);
    setHeld(next);
    void pos.local.set(HELD_KEY, next);
  }

  /**
   * «الطاولات»: a table with an open order brings it back (the order being taken is held first);
   * a free one takes the order being taken when it has no table yet, or starts a new one there.
   */
  function openTable(table: string) {
    const current = cartRef.current;
    if (current.service?.table === table) return;
    // The server's order for this table (a waiter's, or one this till sent from another cart)
    const remote = serverHall.orders.find((o) => o.table === table);
    let rest = held;
    if (current.lines.length > 0 && !current.service?.table) {
      const mine = rest.find((c) => c.service?.table === table);
      if (!mine) {
        if (remote) {
          setCartState(cartFromOrder(remote, catalog, current).cart);
          setDone(null);
          return;
        }
        setCartState({ ...current, service: { orderType: 'dine_in', table } });
        return;
      }
    }
    if (current.lines.length > 0) rest = [...rest, current];
    const index = rest.findIndex((c) => c.service?.table === table);
    let next =
      index >= 0 ? rest[index]! : { ...EMPTY_CART, service: { orderType: 'dine_in' as const, table } };
    if (index >= 0) rest = rest.filter((_, i) => i !== index);
    // Held on this till and also on the server: the server's lines first, this till's new ones after
    if (remote) next = cartFromOrder(remote, catalog, index >= 0 ? newLinesOf(next) : null).cart;
    setHeld(rest);
    void pos.local.set(HELD_KEY, rest);
    setCartState(next);
    setDone(null);
  }

  /** What a till cart holds beyond what the kitchen and the server already have */
  function newLinesOf(cart: Cart): Cart {
    const known = cart.hall?.known ?? {};
    return {
      ...cart,
      lines: cart.lines.map((l) => ({ ...l, qty: l.qty - (known[l.lineNo] ?? 0) })).filter((l) => l.qty > 0),
    };
  }

  /** «للمطبخ» online: the lines not yet on the server go there as one send (the paper ticket prints as ever) */
  async function sendToHall(sent: Cart) {
    const api = serverHall.api;
    const table = sent.service?.table;
    if (!api || !table) return;
    const known = sent.hall?.known ?? {};
    const fresh = sent.lines
      .map((l) => ({ line: l, qty: Math.round((l.qty - (known[l.lineNo] ?? 0)) / 1000) }))
      .filter((x) => x.qty > 0);
    if (fresh.length === 0) return;
    const userId = session.userId;
    let orderId = sent.hall?.orderId ?? serverHall.orders.find((o) => o.table === table)?.id;
    if (!orderId) {
      const opened = await api.command({ type: 'open', userId, table });
      if (opened.kind !== 'ok' || !opened.body.order) return;
      orderId = opened.body.order.id;
    }
    const added = await api.command({
      type: 'add',
      userId,
      orderId,
      lines: fresh.map(({ line, qty }) => ({
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        qty: Math.min(99, qty),
        choices: [...(line.choices ?? [])],
        note: line.note ?? null,
      })),
    });
    if (added.kind !== 'ok') return;
    const done = await api.command({ type: 'send', userId, orderId });
    if (done.kind !== 'ok') return;
    const now: Record<number, number> = {};
    for (const l of sent.lines) now[l.lineNo] = l.qty;
    const id = orderId;
    const ids = done.body.order ? lineIdsOf(sent, done.body.order) : {};
    setCartState((c) =>
      c.service?.table === table ? { ...c, hall: { orderId: id, known: now, lineIds: ids } } : c,
    );
    void serverHall.refresh();
  }

  /** Charging a table closes its order on the server; without a connection it waits in a list */
  function closeHallOrder(paid: Cart, ref: string) {
    const table = paid.service?.table;
    if (!table) return;
    const orderId = paid.hall?.orderId ?? serverHall.orders.find((o) => o.table === table)?.id;
    if (!orderId) return;
    const userId = session.userId;
    const split = paid.hall?.part;
    const part: PendingHallClose['part'] = split
      ? 'lineIds' in split
        ? { lineIds: split.lineIds }
        : { equal: { parts: split.equal.parts } }
      : undefined;
    const later = () =>
      pos.local
        .get<PendingHallClose[]>(HALL_CLOSE_KEY)
        .then((list) =>
          pos.local.set(HALL_CLOSE_KEY, [
            ...(list ?? []),
            { orderId, userId, ref, ...(part ? { part } : {}) },
          ]),
        );
    const api = serverHall.api;
    if (!api) {
      void later();
      return;
    }
    void api
      .command(
        part
          ? {
              type: 'part',
              userId,
              orderId,
              ref,
              ...('lineIds' in part ? { lineIds: part.lineIds } : { equal: part.equal }),
            }
          : { type: 'close', userId, orderId, reason: 'paid', ref },
      )
      .then((answer) => (answer.kind === 'network' ? later() : serverHall.refresh()));
  }

  /** The server's order behind the cart's table, while it can be reached */
  const hallOrder =
    serverHall.reachable && cart.hall
      ? (serverHall.orders.find((o) => o.id === cart.hall!.orderId) ?? null)
      : null;

  /** «قسّم الحساب»: this sale becomes one part of the table's bill (items, or an equal share) */
  function startPart(order: HallOrder, split: { lineIds: string[] } | { parts: number }) {
    const { cart: part } = cartFromOrder(order, catalog, null, split);
    setCartState(part);
    setDone(null);
  }

  const hallTools: HallTools | undefined =
    hallTables.length > 0
      ? {
          order: hallOrder,
          onSplitItems: (lineIds) => hallOrder && startPart(hallOrder, { lineIds }),
          onSplitEqual: (parts) => hallOrder && startPart(hallOrder, { parts }),
          onMoveTable: moveTable,
          cancelSent: async (lineNo, input) => {
            const current = cartRef.current;
            const ids = current.hall?.lineIds?.[lineNo] ?? [];
            if (!current.hall || ids.length === 0) return { kind: 'ok', queued: false };
            const answer = await cancelSentLines({
              api: serverHall.api,
              reachable: serverHall.reachable,
              local: pos.local,
              deps: {
                local: pos.local,
                token: pos.device.token,
                online: pos.online(),
                now: pos.now,
                fetch: pos.fetch,
              },
              staff,
              orderId: current.hall.orderId,
              lineIds: ids,
              userId: session.userId,
              ...input,
            });
            if (answer.kind === 'ok') void serverHall.refresh();
            return answer;
          },
        }
      : undefined;

  /** «نقل / دمج»: a table's order goes to a free table, or joins the order on a busy one */
  async function moveTable(from: string, to: string): Promise<string | null> {
    const source = serverHall.orders.find((o) => o.table === from);
    const target = serverHall.orders.find((o) => o.table === to);
    const mineAt = (table: string) =>
      [...held, ...(cartRef.current.lines.length > 0 ? [cartRef.current] : [])].filter(
        (c) => c.service?.table === table,
      );
    // Lines taken here and not yet with the server would be lost in the move
    const unsent = [...mineAt(from), ...mineAt(to)].some((c) => newLinesOf(c).lines.length > 0);
    if (!source) {
      if (target || mineAt(to).length > 0) return `الطاولة ${to} مشغولة: أرسل الطلبين للمطبخ ثم ادمجهما.`;
      // An order only this till holds: its table is renamed here
      const rename = (c: Cart): Cart =>
        c.service?.table === from ? { ...c, service: { ...c.service, table: to } } : c;
      const next = held.map(rename);
      setHeld(next);
      void pos.local.set(HELD_KEY, next);
      setCartState(rename);
      return null;
    }
    if (unsent) return 'في الطلب أصناف لم تُرسل للمطبخ بعد. أرسلها ثم انقل الطاولة.';
    const api = serverHall.api;
    if (!api) return 'النقل والدمج يحتاجان اتصالاً بالخادم.';
    const answer = await api.command(
      target
        ? { type: 'merge', userId: session.userId, orderId: target.id, fromOrderId: source.id }
        : { type: 'move', userId: session.userId, orderId: source.id, table: to },
    );
    if (answer.kind === 'network') return 'لا يوجد اتصال بالخادم. أعد المحاولة.';
    if (answer.kind === 'refused') return answer.message;
    // The carts here that mirrored these tables are read again from the server
    const gone = (c: Cart) => c.service?.table === from || c.service?.table === to;
    const rest = held.filter((c) => !gone(c));
    setHeld(rest);
    void pos.local.set(HELD_KEY, rest);
    if (gone(cartRef.current)) setCartState(EMPTY_CART);
    await serverHall.refresh();
    return null;
  }

  function reprint() {
    if (!lastSale) return;
    setPrintJob({ data: receiptData(lastSale.doc, lastSale.cashierName), copy: true });
  }

  const extraShortcuts = (event: KeyboardEvent): boolean => {
    if (!event.altKey) return false;
    if (event.code === 'Digit7' && shift) {
      event.preventDefault();
      setView('cash');
      return true;
    }
    if (event.code === 'KeyR' && shift) {
      event.preventDefault();
      setView('return');
      return true;
    }
    if (event.code === 'KeyL') {
      event.preventDefault();
      lock();
      return true;
    }
    return false;
  };

  const statusBar = (
    <StatusBar
      device={pos.device}
      persisted={persisted}
      online={online}
      outbox={outbox}
      notice={notice}
      user={{
        name: session.fullName,
        detail: shift ? `وردية منذ ${clockText(shift.openedAt, digits)}` : 'لا وردية مفتوحة',
      }}
      lastInvoice={
        lastSale ? (
          <button
            type="button"
            onClick={reprint}
            aria-label="إيصال آخر فاتورة"
            className="hidden min-h-12 shrink-0 items-center gap-2 rounded-control px-3 text-sm text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink xl:inline-flex"
          >
            <PrintIcon size={16} />
            آخر فاتورة{' '}
            <bdi dir="ltr" className="num font-semibold text-ink">
              {lastSale.doc.number}
            </bdi>
          </button>
        ) : null
      }
      menu={
        <Menu
          label="المزيد"
          align="end"
          className="w-64"
          trigger={<IconButton label="المزيد" size="md" icon={<MoreIcon />} />}
        >
          {shift ? (
            <MenuItem icon={<UndoIcon />} shortcut="Alt+R" onSelect={() => setView('return')}>
              مرتجع
            </MenuItem>
          ) : null}
          {shift && session.permissions.has('receipt.create') ? (
            <MenuItem icon={<CashIcon />} onSelect={() => setView('receipt')}>
              قبض من زبون
            </MenuItem>
          ) : null}
          {shift && session.permissions.has('sale.create') ? (
            <MenuItem icon={<GiftIcon />} onSelect={() => setView('gift')}>
              قسيمة هدية
            </MenuItem>
          ) : null}
          <MenuItem icon={<ScissorsIcon />} onSelect={() => setView('alterations')}>
            التعديلات
          </MenuItem>
          <MenuSeparator />
          {shift ? (
            <MenuItem icon={<TransferIcon />} shortcut="Alt+7" onSelect={() => setView('cash')}>
              حركات الدرج
            </MenuItem>
          ) : null}
          {lastSale ? (
            <MenuItem icon={<PrintIcon />} onSelect={reprint}>
              إيصال آخر فاتورة
            </MenuItem>
          ) : null}
          <MenuItem icon={<SettingsIcon />} onSelect={() => setView('printer')}>
            الطابعة
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<LockIcon />} shortcut="Alt+L" onSelect={lock}>
            اقفل الشاشة
          </MenuItem>
          {shift ? (
            <MenuItem icon={<LogoutIcon />} onSelect={() => setView('close')}>
              أغلق الوردية
            </MenuItem>
          ) : null}
        </Menu>
      }
    />
  );

  const printPortal = printJob ? (
    <PrintableReceipt data={printJob.data} width={paper} copy={printJob.copy} />
  ) : null;

  if (shift === undefined) return null;

  if (view === 'printer') {
    return (
      <CashierShell statusBar={statusBar} mainClassName="flex justify-center p-6 lg:px-10">
        <PrinterScreen
          setting={printer}
          paper={paper}
          onChange={(next) => {
            setPrinter(next);
            void pos.local.set(PRINTER_KEY, next);
          }}
          onPaper={(w) => {
            setPaper(w);
            void pos.local.set(PAPER_KEY, w);
          }}
          onTest={() => {
            if (lastSale) setPrintJob({ data: receiptData(lastSale.doc, lastSale.cashierName), copy: true });
            else window.print();
          }}
          onBack={() => setView('sale')}
        />
        {printPortal}
      </CashierShell>
    );
  }

  if (shift === null || view !== 'sale') {
    return (
      <CashierShell statusBar={statusBar} mainClassName="flex justify-center p-6 lg:px-10">
        <Suspense fallback={null}>
          {shift === null ? (
            <ShiftOpenScreen session={session} catalog={catalog} onOpened={setShift} />
          ) : view === 'close' ? (
            <ShiftCloseScreen
              session={session}
              catalog={catalog}
              shift={shift}
              onBack={() => setView('sale')}
              onClosed={() => {
                setShift(null);
                setView('sale');
                onSignOut();
              }}
            />
          ) : view === 'receipt' ? (
            <ReceiptScreen
              session={session}
              catalog={catalog}
              shift={shift}
              onBack={() => setView('sale')}
              onPrint={(doc) =>
                setPrintJob({ data: { ...receiptData(doc, session.fullName), kind: 'receipt' }, copy: false })
              }
            />
          ) : view === 'alterations' ? (
            <AlterationsScreen
              catalog={catalog}
              session={session}
              shift={shift}
              onBack={() => setView('sale')}
              onDeliver={(ticket) => {
                // The fee is sold as the «تقصير» service: what is left after the deposit voucher
                const service = catalog.items.find((i) => i.name.includes('تقصير'));
                if (!service) return false;
                const fee = ticket.priceMinor;
                const line = addItem(EMPTY_CART, service);
                setCart(() => ({
                  ...line,
                  lines: line.lines.map((l) => ({
                    ...l,
                    name: `${l.name} · ${ticket.number}`,
                    priceMinor: fee,
                    retailPriceMinor: fee,
                    wholesalePriceMinor: null,
                    priceCurrency: ticket.currency,
                  })),
                  ...(ticket.depositVoucher ? { voucher: ticket.depositVoucher } : {}),
                  alteration: { id: ticket.id, number: ticket.number, version: ticket.version },
                }));
                setDone(null);
                setView('sale');
                return true;
              }}
            />
          ) : view === 'gift' ? (
            <GiftVoucherScreen
              session={session}
              catalog={catalog}
              shift={shift}
              onBack={() => setView('sale')}
              onPrint={(doc) =>
                setPrintJob({ data: { ...receiptData(doc, session.fullName), kind: 'gift' }, copy: false })
              }
            />
          ) : view === 'return' ? (
            <ReturnScreen
              session={session}
              catalog={catalog}
              staff={staff}
              shift={shift}
              onBack={() => setView('sale')}
              onPrint={(doc) =>
                setPrintJob({ data: { ...receiptData(doc, session.fullName), kind: 'return' }, copy: false })
              }
              onExchange={(code) => {
                // A cash exchange has no voucher: the return went out in cash, the other piece is paid in cash
                if (code) setCart((c) => ({ ...c, voucher: code }));
                setDone(null);
                setView('sale');
              }}
            />
          ) : (
            <CashMovementScreen
              session={session}
              catalog={catalog}
              staff={staff}
              shift={shift}
              onBack={() => setView('sale')}
            />
          )}
        </Suspense>
        {printPortal}
      </CashierShell>
    );
  }

  const last = lastSale ? (lastSale.doc.payload as unknown as SalePayload) : null;
  return (
    <>
      <SaleScreen
        statusBar={statusBar}
        session={session}
        catalog={catalog}
        staff={staff}
        shiftId={shift.id}
        cart={cart}
        setCart={setCart}
        heldCount={held.length}
        heldList={held}
        onHold={hold}
        onResume={resume}
        onDiscardHeld={discardHeld}
        heldCarts={[...held, ...serverOnly]}
        onOpenTable={openTable}
        onKitchenSent={(sent) => void sendToHall(sent)}
        hallTools={hallTools}
        lastLines={
          last ? last.lines.map((l) => ({ variantId: l.variantId, barcode: l.barcode, qty: l.qty })) : []
        }
        onSaved={saved}
        done={
          done ? (
            <SaleDone
              data={done}
              online={online}
              width={paper}
              onWidth={(w) => {
                setPaper(w);
                void pos.local.set(PAPER_KEY, w);
              }}
              onPrint={() => setPrintJob({ data: done, copy: false })}
              onNewSale={() => setDone(null)}
            />
          ) : null
        }
        onNextSale={() => setDone(null)}
        extraShortcuts={extraShortcuts}
        onPrintDeposit={(doc) =>
          setPrintJob({ data: { ...receiptData(doc, session.fullName), kind: 'gift' }, copy: false })
        }
      />
      {printPortal}
    </>
  );
}
