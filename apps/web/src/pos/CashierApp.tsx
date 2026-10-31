import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { OutboxEntry, SyncDocument } from '@serva/sync';
import { Button, CashierShell, EmptyState, MoreIcon, PrintIcon, useDigits, WarningIcon } from '@serva/ui';
import type { Catalog } from './catalog';
import { clockText } from './format';
import { PrintableReceipt, type PaperWidth, type ReceiptData } from './receipt/Receipt';
import { SaleDone } from './receipt/SaleDone';
import { EMPTY_CART, type Cart } from './sale/cart';
import { SaleScreen } from './sale/SaleScreen';
import { usePos } from './services';
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
const CashMovementScreen = lazy(() =>
  import('./shift/ShiftScreens').then((m) => ({ default: m.CashMovementScreen })),
);

/** Minutes without a touch or a key before the device signs the cashier out (09 › tenant_settings). */
export const DEFAULT_IDLE_MINUTES = 5;

const HELD_KEY = 'heldCarts';
const LAST_SALE_KEY = 'lastSale';
const PAPER_KEY = 'paperWidth';
const cartKey = (userId: string) => `cart:${userId}`;

interface LastSale {
  doc: Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;
  cashierName: string;
}

type View = 'sale' | 'close' | 'cash';

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
export function CashierApp({ session, catalog, persisted, online, outbox, onSignOut }: CashierAppProps) {
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    let alive = true;
    void Promise.all([
      readShift(pos.local, settings.shiftMode, session.userId),
      pos.local.get<Cart>(cartKey(session.userId)),
      pos.local.get<Cart[]>(HELD_KEY),
      pos.local.get<LastSale>(LAST_SALE_KEY),
      pos.local.get<PaperWidth>(PAPER_KEY),
    ]).then(([openShift, savedCart, heldCarts, last, width]) => {
      if (!alive) return;
      setShift(openShift);
      if (savedCart) {
        setCartState(savedCart);
        void pos.local.remove(cartKey(session.userId));
      }
      setHeld(heldCarts ?? []);
      setLastSale(last);
      if (width) setPaper(width);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, settings, session.userId]);

  const setCart = useCallback((update: (cart: Cart) => Cart) => setCartState(update), []);

  /** Signs out, keeping an unfinished cart for this cashier's next sign-in. */
  const lock = useCallback(() => {
    const current = cartRef.current;
    void (
      current.lines.length > 0 ? pos.local.set(cartKey(session.userId), current) : Promise.resolve()
    ).finally(onSignOut);
  }, [pos.local, session.userId, onSignOut]);

  const idleMinutes = (settings as { idleMinutes?: number } | null)?.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  useIdle(idleMinutes * 60_000, lock);

  // Print once the receipt is in the page; the portal stays until the next one.
  useEffect(() => {
    if (!printJob) return;
    const timer = setTimeout(() => {
      try {
        window.print();
      } catch {
        // No printer dialog in this environment: the receipt stays on screen.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [printJob]);

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

  function reprint() {
    if (!lastSale) return;
    setMenuOpen(false);
    setPrintJob({ data: receiptData(lastSale.doc, lastSale.cashierName), copy: true });
  }

  const extraShortcuts = (event: KeyboardEvent): boolean => {
    if (!event.altKey) return false;
    if (event.code === 'Digit7' && shift) {
      event.preventDefault();
      setView('cash');
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
            className="hidden min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-muted px-3 text-sm font-semibold text-ink lg:inline-flex"
          >
            <PrintIcon size={16} />
            آخر فاتورة{' '}
            <bdi dir="ltr" className="num">
              {lastSale.doc.number}
            </bdi>
          </button>
        ) : null
      }
      menu={
        <div className="relative">
          <button
            type="button"
            aria-label="المزيد"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid size-11 place-items-center rounded-control text-ink hover:bg-surface-muted"
          >
            <MoreIcon size={20} />
          </button>
          {menuOpen ? (
            <ul
              role="menu"
              aria-label="المزيد"
              className="absolute end-0 top-12 z-60 flex w-64 flex-col rounded-card border border-line bg-surface p-2 shadow-e3"
            >
              {(
                [
                  shift ? { label: 'حركات الدرج', key: 'Alt+7', action: () => setView('cash') } : null,
                  lastSale ? { label: 'إيصال آخر فاتورة', key: null, action: reprint } : null,
                  { label: 'اقفل الشاشة', key: 'Alt+L', action: lock },
                  shift ? { label: 'أغلق الوردية', key: null, action: () => setView('close') } : null,
                ] satisfies ({ label: string; key: string | null; action: () => void } | null)[]
              )
                .filter((item) => item !== null)
                .map(({ label, key, action }) => (
                  <li key={label}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        action();
                      }}
                      className="flex min-h-12 w-full items-center justify-between rounded-control px-3 text-start font-semibold text-ink hover:bg-surface-muted"
                    >
                      {label}
                      {key ? (
                        <kbd dir="ltr" className="text-xs font-normal text-ink-muted">
                          {key}
                        </kbd>
                      ) : null}
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      }
    />
  );

  const printPortal = printJob ? (
    <PrintableReceipt data={printJob.data} width={paper} copy={printJob.copy} />
  ) : null;

  if (shift === undefined) return null;

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
      />
      {printPortal}
    </>
  );
}
