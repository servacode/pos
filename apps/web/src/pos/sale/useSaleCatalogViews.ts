import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { packPrice } from '@serva/core/sale';
import { type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { setPriceTier, type Cart } from './cart';
import { modelPieces, orderPieces } from './models';
import type { PriceCheck } from './ItemsArea';
import type { SaleScreenProps } from './saleTypes';

export interface CatalogViewsArgs {
  catalog: Catalog;
  cart: Cart;
  setCart: SaleScreenProps['setCart'];
  setCheck: (check: PriceCheck | null) => void;
}

/** What the sale reads off the catalog and the cart: the models, the wholesale tier, what is in the cart, the price check */
export function useSaleCatalogViews({ catalog, cart, setCart, setCheck }: CatalogViewsArgs) {
  const pieces = useMemo(() => modelPieces(catalog.items), [catalog.items]);
  // «سعر الجملة» shows only where some item has a wholesale price (a clothing shop has none).
  const hasWholesale = useMemo(
    () => catalog.items.some((item) => (item.price.wholesalePriceMinor ?? null) !== null),
    [catalog.items],
  );
  const inCart = useMemo(() => new Set(cart.lines.map((l) => l.variantId)), [cart.lines]);
  // A wholesale customer on the cart (however he got there: the pay panel, a quotation, a held sale) brings the
  // wholesale prices once; the cashier can still switch back to the shelf price by hand
  const tierAppliedFor = useRef<string | null>(null);
  const cartCustomerId = cart.customer?.id ?? null;
  useEffect(() => {
    if (!cartCustomerId) {
      tierAppliedFor.current = null;
      return;
    }
    if (tierAppliedFor.current === cartCustomerId || cart.lines.length === 0) return;
    tierAppliedFor.current = cartCustomerId;
    const known = catalog.customers.find((c) => c.id === cartCustomerId);
    if (known?.priceTier === 'wholesale' && cart.priceTier !== 'wholesale')
      setCart((c) => setPriceTier(c, 'wholesale'));
  }, [cartCustomerId, catalog.customers, cart.priceTier, cart.lines.length, setCart]);
  /** What the cart holds of each piece, thousandths (taken off the stock the picker shows) */
  const inCartQty = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart.lines)
      map.set(l.variantId, (map.get(l.variantId) ?? 0) + (l.qty * l.packQty) / 1000);
    return map;
  }, [cart.lines]);

  /** The boxes each piece is sold in, with the box's price, for the price checker */
  const boxesOf = useCallback(
    (list: readonly CatalogItem[]): NonNullable<PriceCheck['packs']> => {
      const wanted = new Set(list.map((p) => p.variantId));
      const out: Record<
        string,
        { name: string | null; qty: number; priceMinor: number; currency: CurrencyCode }[]
      > = {};
      for (const hit of catalog.byBarcode.values()) {
        const { item, barcode } = hit;
        if (barcode.packQty === 1000 || !wanted.has(item.variantId)) continue;
        const rows = (out[item.variantId] ??= []);
        if (rows.some((r) => r.qty === barcode.packQty)) continue;
        rows.push({
          name: barcode.packName,
          qty: barcode.packQty,
          priceMinor: packPrice(item.price.priceMinor, barcode.packQty, barcode.packPriceMinor),
          currency: item.price.currency,
        });
      }
      return out;
    },
    [catalog.byBarcode],
  );

  /** Shows an item's price and stock (all its sizes and colours) and adds nothing */
  const showPrice = useCallback(
    (item: CatalogItem, hit?: BarcodeHit | null) => {
      const model = pieces.get(item.productId);
      const packQty = hit?.barcode.packQty ?? 1000;
      setCheck({
        name: model ? (model[0]!.productName ?? item.name) : item.name,
        pieces: model ? orderPieces(model) : [item],
        focus: item.variantId,
        packs: boxesOf(model ?? [item]),
        pack:
          hit && packQty !== 1000
            ? {
                name: hit.barcode.packName,
                qty: packQty,
                priceMinor: packPrice(item.price.priceMinor, packQty, hit.barcode.packPriceMinor),
                currency: item.price.currency,
              }
            : null,
      });
    },
    [pieces, boxesOf, setCheck],
  );
  return { pieces, hasWholesale, inCart, inCartQty, boxesOf, showPrice };
}
