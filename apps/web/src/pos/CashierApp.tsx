import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EMPTY_CART, type Cart } from './sale/cart';
import { SaleScreen } from './sale/SaleScreen';
import { PosProvider, usePos } from './services';
import { validated } from './validate';
import { readShift, type OpenShift } from './shift/shift';
import { staffRoster, type StaffSession } from './staff/staff';
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
const LAST_SALE_KEY = 'lastSale';
const PAPER_KEY = 'paperWidth';
const cartKey = (userId: string) => `cart:${userId}`;

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
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [done, setDone] = useState<ReceiptData | null>(null);
  const [paper, setPaper] = useState<PaperWidth>(80);
  const [printJob, setPrintJob] = useState<{ data: ReceiptData; copy: boolean } | null>(null);
  const [printer, setPrinter] = useState<PrinterSetting>(DEFAULT_PRINTER);

  const shiftMode = settings?.shiftMode ?? null;
  useEffect(() => {
    if (!shiftMode) return;
    let alive = true;
    void Promise.all([
      readShift(pos.local, shiftMode, session.userId),
      pos.local.get<Cart>(cartKey(session.userId)),
      pos.local.get<Cart[]>(HELD_KEY),
      pos.local.get<LastSale>(LAST_SALE_KEY),
      pos.local.get<PaperWidth>(PAPER_KEY),
      pos.local.get<PrinterSetting>(PRINTER_KEY),
    ]).then(([openShift, savedCart, heldCarts, last, width, printerSetting]) => {
      if (!alive) return;
      setShift(openShift);
      if (savedCart) {
        setCartState(savedCart);
        void pos.local.remove(cartKey(session.userId));
      }
      setHeld(heldCarts ?? []);
      setLastSale(last);
      if (width) setPaper(width);
      if (printerSetting) setPrinter(printerSetting);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, shiftMode, session.userId]);

  const setCart = useCallback((update: (cart: Cart) => Cart) => setCartState(update), []);

  /** Signs out, keeping an unfinished cart for this cashier's next sign-in. */
  const lock = useCallback(() => {
    const current = cartRef.current;
    void (
      current.lines.length > 0 ? pos.local.set(cartKey(session.userId), current) : Promise.resolve()
    ).finally(onSignOut);
  }, [pos.local, session.userId, onSignOut]);

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
        statusBar={<StatusBar device={pos.device} persisted={persisted} online={online} outbox={outbox} />}
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
  });

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
    setCartState(EMPTY_CART);
    const data = receiptData(last.doc, session.fullName);
    setDone(data);
    setPrintJob({ data, copy: false });
  }

  function hold() {
    if (cart.lines.length === 0) return;
    const next = [...held, cart];
    setHeld(next);
    void pos.local.set(HELD_KEY, next);
    setCartState(EMPTY_CART);
    setDone(null);
  }

  function resume() {
    if (held.length === 0 || cart.lines.length > 0) return;
    const next = held.slice(0, -1);
    setCartState(held[held.length - 1]!);
    setHeld(next);
    void pos.local.set(HELD_KEY, next);
    setDone(null);
  }

  /**
   * «الطاولات»: a table with an open order brings it back (the order being taken is held first);
   * a free one takes the order being taken when it has no table yet, or starts a new one there.
   */
  function openTable(table: string) {
    const current = cartRef.current;
    if (current.service?.table === table) return;
    let rest = held;
    if (current.lines.length > 0 && !current.service?.table) {
      const mine = rest.find((c) => c.service?.table === table);
      if (!mine) {
        setCartState({ ...current, service: { orderType: 'dine_in', table } });
        return;
      }
    }
    if (current.lines.length > 0) rest = [...rest, current];
    const index = rest.findIndex((c) => c.service?.table === table);
    const next =
      index >= 0 ? rest[index]! : { ...EMPTY_CART, service: { orderType: 'dine_in' as const, table } };
    if (index >= 0) rest = rest.filter((_, i) => i !== index);
    setHeld(rest);
    void pos.local.set(HELD_KEY, rest);
    setCartState(next);
    setDone(null);
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
            <AlterationsScreen catalog={catalog} onBack={() => setView('sale')} />
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
                setCart((c) => ({ ...c, voucher: code }));
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
        onHold={hold}
        onResume={resume}
        heldCarts={held}
        onOpenTable={openTable}
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
