import { useCallback } from 'react';
import { dayText } from '../../lib/dates';
import { CURRENCIES } from '@serva/core/currencies';
import { businessDateOf, rateFor } from '@serva/core/sale';
import { allocateFefo, pickBatch, usesAutoBatch } from '@serva/core/pharmacy';
import type { useDigits } from '@serva/ui';
import { type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import type { StaffSession } from '../staff/staff';
import {
  addItem,
  type ItemChoice,
  updateLine,
  type Cart,
  type CartLine as Line,
  type PricingContext,
} from './cart';
import type { SaleMode, SaleNotice, SaleScreenProps } from './saleTypes';

interface PendingAdd {
  item: CatalogItem;
  hit: BarcodeHit | null;
  weighedQty: number | undefined;
  choice: ItemChoice | undefined;
}

export interface SaleAddArgs {
  ctx: PricingContext;
  multiplier: number | null;
  setCart: SaleScreenProps['setCart'];
  mode: SaleMode;
  props: SaleScreenProps;
  settings: NonNullable<Catalog['settings']>;
  session: StaffSession;
  digits: ReturnType<typeof useDigits>;
  setMode: (mode: SaleMode) => void;
  setSelected: (lineNo: number | null) => void;
  setZeroAsk: (ask: PendingAdd) => void;
  setOutAsk: (ask: PendingAdd) => void;
  setNotice: (notice: SaleNotice | null) => void;
  setMultiplier: (qty: number | null) => void;
  setBump: (lineNo: number | null) => void;
  zeroOk: { current: boolean };
  outOk: { current: boolean };
  cartRef: { current: Cart };
}

/** Puts an item into the cart, after the questions it may need first (a fee, a zero price, no stock, a batch, modifiers) */
export function useSaleAdd({
  ctx,
  multiplier,
  setCart,
  mode,
  props,
  settings,
  session,
  digits,
  setMode,
  setSelected,
  setZeroAsk,
  setOutAsk,
  setNotice,
  setMultiplier,
  setBump,
  zeroOk,
  outOk,
  cartRef,
}: SaleAddArgs) {
  return useCallback(
    (
      item: CatalogItem,
      hit?: BarcodeHit | null,
      weighedQty?: number,
      choice?: ItemChoice,
      feeMinor?: number,
    ) => {
      // A service with no fixed fee: the fee pad opens first and NO line exists until the fee is confirmed
      if (item.isService && item.price.priceMinor === 0 && feeMinor === undefined) {
        setMode({ kind: 'fee', item, hit: hit ?? null });
        return;
      }
      if (
        item.price.priceMinor === 0 &&
        !item.isService &&
        !zeroOk.current &&
        !cartRef.current.lines.some((l) => l.variantId === item.variantId)
      ) {
        setZeroAsk({ item, hit: hit ?? null, weighedQty, choice });
        return;
      }
      // A piece sold by its serial number: a second tap never piles up lines of numbers not given yet,
      // nor of pieces beyond what the store holds (it asks, like an item with nothing left)
      if (item.tracksSerial && feeMinor === undefined && !outOk.current) {
        const mine = cartRef.current.lines.filter((l) => l.variantId === item.variantId);
        const pieces = (l: Line) => Math.round((l.qty * l.packQty) / 1_000_000);
        const waiting = mine.find((l) => (l.serials?.length ?? 0) < pieces(l));
        if (waiting) {
          setSelected(waiting.lineNo);
          setMode({ kind: 'serial', lineNo: waiting.lineNo });
          return;
        }
        if (
          mine.length > 0 &&
          typeof item.stockQty === 'number' &&
          mine.reduce((sum, l) => sum + pieces(l), 0) * 1000 >= item.stockQty
        ) {
          setOutAsk({ item, hit: hit ?? null, weighedQty, choice });
          return;
        }
      }
      if (
        !item.isService &&
        feeMinor === undefined &&
        typeof item.stockQty === 'number' &&
        item.stockQty <= 0 &&
        !outOk.current &&
        !cartRef.current.lines.some((l) => l.variantId === item.variantId)
      ) {
        setOutAsk({ item, hit: hit ?? null, weighedQty, choice });
        return;
      }
      // An item with modifiers asks for its choices first (beside the cart, not over it)
      if (item.modifiers?.length && weighedQty === undefined && !choice) {
        setMode({ kind: 'choose', item, hit: hit ?? null });
        return;
      }
      if (item.price.currency !== ctx.currency) {
        try {
          rateFor(ctx.rates, item.price.currency, ctx.currency);
        } catch {
          setNotice({
            tone: 'warning',
            text: `لا يوجد سعر صرف لـ${CURRENCIES[item.price.currency].nameAr} على هذا الجهاز، فلا يُباع «${item.name}» الآن.`,
          });
          return;
        }
      }
      // 03 › الصيدليات: a controlled drug is the pharmacist's alone
      if (item.controlled && !session.permissions.has('pharmacy.controlled')) {
        setNotice({
          tone: 'warning',
          text: `«${item.name}» دواء مراقَب، لا يبيعه إلا الصيدلاني.`,
        });
        return;
      }
      // …and no box of an expired batch goes out: the nearest batch that is still good is taken
      const today = businessDateOf(Date.now(), settings.timezone, settings.businessDayCutoff);
      // A branch that has its batches' balances (stock_levels.batches) plans them for the whole cart
      // at payment (batches.ts); one that has only the dates (an older pull) picks here as before.
      const planned = usesAutoBatch(settings.pharmacy) && Array.isArray(item.stockBatches);
      const pick = planned
        ? { kind: 'ok' as const, batch: allocateFefo(item.stockBatches!, 1, today).allocations[0] }
        : usesAutoBatch(settings.pharmacy)
          ? pickBatch(item.shelfBatches, today)
          : { kind: 'none' as const };
      if (pick.kind === 'expired') {
        setNotice({
          tone: 'warning',
          text: `لا يُباع «${item.name}»: كل دفعاته على الرف منتهية الصلاحية (آخرها ${pick.latest}).`,
        });
        return;
      }
      const shown = pick.kind === 'ok' && pick.batch ? pick.batch : null;
      const batch = planned ? null : (shown as { batchNo: string | null; expiry: string } | null);
      const qty = weighedQty ?? (multiplier ?? 1) * 1000;
      setMultiplier(null);
      setNotice(null);
      if (props.done) props.onNextSale();
      // From the latest cart, so scans arriving before the next render all count.
      const current = cartRef.current;
      let next: Cart;
      let added: number | null;
      if (feeMinor !== undefined) {
        // Confirmed fee: a line of its own at that fee (the same fee again just adds one more)
        const sameFee = current.lines.find(
          (l) => l.variantId === item.variantId && l.priceMinor === feeMinor && l.adjustment === null,
        );
        if (sameFee) {
          next = updateLine(current, sameFee.lineNo, { qty: sameFee.qty + qty });
          added = sameFee.lineNo;
        } else {
          const fresh = addItem({ ...current, lines: [] }, item, hit, qty, choice ?? null, batch);
          const line = {
            ...fresh.lines[0]!,
            priceMinor: feeMinor,
            priceCurrency: ctx.currency,
            adjustment: null,
            priceTyped: true,
          };
          next = { ...current, nextLineNo: fresh.nextLineNo, lines: [...current.lines, line] };
          added = line.lineNo;
        }
      } else {
        next = addItem(current, item, hit, qty, choice ?? null, batch);
        added = next.lines.find((l, i) => l !== current.lines[i])?.lineNo ?? null;
      }
      cartRef.current = next;
      setCart(() => next);
      setBump(added);
      // 03 › الصيدليات: what is on the shelf may have expired, or soon will
      const expiry = shown ? shown.expiry : planned ? null : item.nearestExpiry;
      if (expiry) {
        const soon = businessDateOf(
          Date.now() + 30 * 86_400_000,
          settings.timezone,
          settings.businessDayCutoff,
        );
        if (expiry < today) {
          setNotice({
            tone: 'warning',
            text: `صلاحية «${item.name}» انتهت في ${dayText(expiry, digits)} حسب آخر استلام. تأكد من العلبة قبل البيع.`,
          });
        } else if (expiry <= soon) {
          // Near its end: it goes first, whatever else is on the shelf (nearest expiry first)
          setNotice({
            tone: 'warning',
            text: shown?.batchNo
              ? `صلاحية «${item.name}» (دفعة ${shown.batchNo}) تنتهي في ${dayText(expiry, digits)}. أقرب انتهاء أولاً: تأكد من العلبة قبل البيع.`
              : `صلاحية «${item.name}» تنتهي في ${dayText(expiry, digits)}. أقرب انتهاء أولاً: تأكد من العلبة قبل البيع.`,
          });
        }
      }
      if (item.tracksSerial && added !== null) {
        setSelected(added);
        setMode({ kind: 'serial', lineNo: added });
      } else if (item.unit?.allowsFraction && added !== null && weighedQty === undefined) {
        setSelected(added);
        setMode({ kind: 'line', lineNo: added, adjust: 'qty' });
      } else if (mode.kind === 'pay' || mode.kind === 'done' || mode.kind === 'help') {
        setMode({ kind: 'items' });
      }
    },
    [
      ctx,
      multiplier,
      setCart,
      mode.kind,
      props,
      setMode,
      setSelected,
      setZeroAsk,
      setOutAsk,
      setNotice,
      setMultiplier,
      setBump,
      zeroOk,
      outOk,
      cartRef,
      settings.timezone,
      settings.businessDayCutoff,
      settings.pharmacy,
      session.permissions,
      digits,
    ],
  );
}
