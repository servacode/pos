import { useEffect, useState } from 'react';
import type { Catalog } from '../catalog';
import type { StaffMember, StaffSession } from '../staff/staff';
import { deviceDocuments } from '../shift/shift';
import { bestSellers } from './bestSellers';
import type { Cart } from './cart';
import { usePos } from '../services';
import { isUnfedService } from './serviceFee';
import { LAST_UNIT_KEY, SELLER_KEY, type SaleNotice, type SaleScreenProps } from './saleTypes';

export interface SaleDeviceArgs {
  catalog: Catalog;
  cart: Cart;
  session: StaffSession;
  staff: readonly StaffMember[];
  setNotice: (notice: SaleNotice | null) => void;
  onHold: SaleScreenProps['onHold'];
}

/** What this device remembers for the sale: the seller, the units last used, the best sellers, and «علّق» */
export function useSaleDevice({ catalog, cart, session, staff, setNotice, onHold }: SaleDeviceArgs) {
  // «البائع» (03 › الملابس: عمولة البائع): the last one picked on this device stays picked
  const pos = usePos();
  // «الأكثر بيعاً»: the products this device sold most lately, for the strip at the top of the grid
  const [best, setBest] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then(
      (list) => alive && setBest(bestSellers(catalog, list)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pos.store, catalog]);
  const [seller, setSeller] = useState<string>(session.userId);
  useEffect(() => {
    let alive = true;
    // Kept only for the sale in progress of the same cashier: never carried to the next sale or shift
    void pos.local.get<string | { by: string; id: string }>(SELLER_KEY).then((saved) => {
      if (!alive || !saved || typeof saved === 'string') return;
      if (saved.by === session.userId && staff.some((m) => m.id === saved.id)) setSeller(saved.id);
    });
    return () => {
      alive = false;
    };
  }, [pos.local, staff, session.userId]);
  const [lastUnits, setLastUnits] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void pos.local.get<Record<string, string>>(LAST_UNIT_KEY).then((saved) => {
      if (alive && saved && typeof saved === 'object') setLastUnits(saved);
    });
    return () => {
      alive = false;
    };
  }, [pos.local]);
  // The sale put on hold keeps its seller with it: the new empty cart starts with the cashier again
  const holdSale = (name?: string) => {
    // A service with no fee is not a sale yet: it is never held
    if (cart.lines.some((l) => isUnfedService(l, catalog.byVariant))) {
      setNotice({ tone: 'warning', text: 'حدّد أجرة الخدمة أولاً، أو احذف سطرها، ثم علّق الفاتورة.' });
      return;
    }
    // Every held cart keeps its seller (the cashier when none was picked), so the list always says who
    const heldSeller = seller;
    setSeller(session.userId);
    void pos.local.remove(SELLER_KEY);
    onHold(name, heldSeller);
  };
  // A held cart brought back restores the seller it was held with
  const cartSeller = cart.sellerId;
  useEffect(() => {
    if (!cartSeller) return;
    if (!staff.some((m) => m.id === cartSeller)) return;
    setSeller(cartSeller);
    void pos.local.set(SELLER_KEY, { by: session.userId, id: cartSeller });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSeller]);
  return { pos, best, seller, setSeller, lastUnits, setLastUnits, holdSale };
}
