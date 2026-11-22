import { useEffect, useRef, useState } from 'react';
import type { StaffSession } from '../staff/staff';
import { type Cart, type PricedCart } from './cart';
import { PAY_OPEN_KEY, type PosServices, type SaleMode } from './saleTypes';

export interface PayResumeArgs {
  pos: PosServices;
  priced: PricedCart | null;
  cart: Cart;
  session: StaffSession;
  mode: SaleMode;
  totalMinor: number;
  setMode: (mode: SaleMode) => void;
}

export function usePayResume({ pos, priced, cart, session, mode, totalMinor, setMode }: PayResumeArgs) {
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
  }, [payKeyLoaded, priced, cart.lines.length, totalMinor, session.userId, pos.local, setMode]);
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
}
