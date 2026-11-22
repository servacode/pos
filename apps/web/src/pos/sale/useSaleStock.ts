import { useEffect, useMemo, useRef, useState } from 'react';
import { businessDateOf } from '@serva/core/sale';
import { promotionActive } from '@serva/core/promotions';
import type { OutboxEntry } from '@serva/sync';
import type { Catalog } from '../catalog';
import { batchGuard, planBatches } from './batches';
import { reservedForOthers } from './reserved';
import { deviceDocuments } from '../shift/shift';
import { couponPromotion, type Cart } from './cart';
import { usePos } from '../services';
import { ONLINE_SOLD_KEY } from './onlineOrders';
import { flushShortages } from './shortages';
import type { SaleScreenProps } from './saleTypes';

export interface SaleStockArgs {
  catalog: Catalog;
  cart: Cart;
  settings: NonNullable<Catalog['settings']>;
  heldList: SaleScreenProps['heldList'];
  done: SaleScreenProps['done'];
}

/**
 * What the sale is checked against: the promotions running now, what online orders and held carts keep
 * back, what this till sold and has not sent yet, and the batch plan with its guard (03 › الصيدليات).
 */
export function useSaleStock({ catalog, cart, settings, heldList, done }: SaleStockArgs) {
  // The promotions running now, read again with every change to the cart so an hour's offer starts
  // and stops on time.
  const activePromotions = useMemo(() => {
    const now = new Date();
    const running = catalog.promotions.filter((p) => promotionActive(p, now, settings.timezone));
    // A shop order's coupon: the offer its code opened applies to this sale, as the order was placed
    return cart.onlineOrder?.couponRule
      ? [...running, couponPromotion(cart.onlineOrder.couponRule)]
      : running;
  }, [catalog.promotions, settings.timezone, cart]);
  // 03 › الصيدليات: what the cart takes from which batch (first expiry first), and from the shelf.
  // What this till sold and has not sent yet comes off what it last pulled, as it works offline.
  const posServices = usePos();
  // A pharmacy's shortage requests kept while the till was offline go to the server once it can reach it (round 38)
  useEffect(() => {
    void flushShortages(posServices);
  }, [posServices]);
  // Online orders this till sold, until the next pull says they are done
  const [soldOnline, setSoldOnline] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void posServices.local.get<string[]>(ONLINE_SOLD_KEY).then((ids) => {
      if (alive && ids) setSoldOnline(ids);
    });
    return () => {
      alive = false;
    };
  }, [posServices.local]);
  // Decision 14: what customers' holds and the carts put aside keep back, so the same piece is not sold twice
  const reservedNow = useMemo(
    () =>
      reservedForOthers({
        orders: catalog.onlineOrders,
        soldOnline,
        held: heldList ?? [],
        cart,
        branchId: catalog.staff.branches.find((b) => b.code === posServices.device.branchCode)?.id ?? null,
        till: settings.till,
        now: Date.now(),
      }),
    [
      catalog.onlineOrders,
      catalog.staff.branches,
      soldOnline,
      heldList,
      cart,
      posServices.device.branchCode,
      settings.till,
    ],
  );
  // The tiles read the reserved map: keep the same object while its content is the same, so a cart edit does not redraw the grid
  const reservedStable = useRef(reservedNow);
  if (
    reservedStable.current !== reservedNow &&
    (reservedStable.current.size !== reservedNow.size ||
      [...reservedNow].some(([id, qty]) => reservedStable.current.get(id) !== qty))
  )
    reservedStable.current = reservedNow;
  const [unsent, setUnsent] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void deviceDocuments(posServices.store).then((list) => alive && setUnsent(list));
    return () => {
      alive = false;
    };
  }, [posServices.store, done]);
  const batchPlan = useMemo(
    () =>
      planBatches({
        cart,
        // The plan takes the unsent sales off the pulled stock itself: it must not see the tiles' lowered one
        catalog: catalog.original ?? catalog,
        today: businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff),
        pending: unsent,
        pharmacy: settings.pharmacy,
        reserved: reservedNow,
      }),
    [cart, catalog, unsent, settings.timezone, settings.businessDayCutoff, settings.pharmacy, reservedNow],
  );
  // The manager's code allowed an expired batch to be sold (the store's «بيع المنتهي برمز المدير»): the lines then
  // take from it, last, and say so on the document (round 38). Approval and warnings still follow the plan above.
  const expiredAllowed =
    settings.pharmacy?.allowExpiredWithCode === true &&
    batchPlan.uncovered.some((i) => i.expiredQty > 0) &&
    cart.batchApproval?.sig === batchPlan.signature;
  const takePlan = useMemo(
    () =>
      expiredAllowed
        ? planBatches({
            cart,
            catalog: catalog.original ?? catalog,
            today: businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff),
            pending: unsent,
            pharmacy: settings.pharmacy,
            reserved: reservedNow,
            allowExpired: true,
          })
        : batchPlan,
    [
      expiredAllowed,
      batchPlan,
      cart,
      catalog,
      unsent,
      settings.timezone,
      settings.businessDayCutoff,
      settings.pharmacy,
      reservedNow,
    ],
  );
  const guard = useMemo(
    () => batchGuard(batchPlan, settings.pharmacy, settings.till?.blockNegativeStock === true),
    [batchPlan, settings.pharmacy, settings.till],
  );
  const batchApproved = cart.batchApproval?.sig === batchPlan.signature;
  const batchWaits = guard.approvals.length > 0 && !batchApproved;
  return {
    activePromotions,
    posServices,
    soldOnline,
    setSoldOnline,
    reserved: reservedStable.current,
    batchPlan,
    takePlan,
    guard,
    batchWaits,
  };
}
