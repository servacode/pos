import { useCallback } from 'react';
import { type BarcodeHit, type CatalogItem } from '../catalog';
import type { ItemChoice } from './cart';
import type { modelPieces } from './models';
import { optionsOf, orderPieces, pieceFor } from './models';
import type { PriceCheck } from './ItemsArea';
import { unitName, type SaleMode } from './saleTypes';

export interface PickersArgs {
  handlers: {
    current: {
      add: SaleAddFn;
      showPrice: (item: CatalogItem, hit?: BarcodeHit | null) => void;
      packsByVariant: Map<string, BarcodeHit[]>;
      saleUnits: { current: Record<string, string> };
    };
  };
  checkingRef: { current: boolean };
  pickerAddedAt: { current: number };
  pieces: ReturnType<typeof modelPieces>;
  boxesOf: (list: readonly CatalogItem[]) => NonNullable<PriceCheck['packs']>;
  setMode: (mode: SaleMode) => void;
  setJustAdded: (text: string | null) => void;
  setCheck: (check: PriceCheck | null) => void;
}

type SaleAddFn = (
  item: CatalogItem,
  hit?: BarcodeHit | null,
  weighedQty?: number,
  choice?: ItemChoice,
  feeMinor?: number,
) => void;

/** The tiles' and the search field's picks: a piece or a box, a size chip; with «سعر صنف» on they only show the price */
export function useSalePickers({
  handlers,
  checkingRef,
  pickerAddedAt,
  pieces,
  boxesOf,
  setMode,
  setJustAdded,
  setCheck,
}: PickersArgs) {
  const pickItem = useCallback(
    (item: CatalogItem, hit?: BarcodeHit | null) => {
      if (Date.now() - pickerAddedAt.current < 350) return;
      if (checkingRef.current) handlers.current.showPrice(item, hit);
      else if (!hit && handlers.current.packsByVariant.has(item.variantId)) {
        // Picked with no barcode: the unit chosen earlier in THIS sale goes in with one tap; otherwise the piece or which box?
        const last = handlers.current.saleUnits.current[item.variantId];
        const pack =
          last && last !== 'piece'
            ? handlers.current.packsByVariant.get(item.variantId)!.find((h) => h.barcode.id === last)
            : undefined;
        if (last === 'piece' || pack) {
          handlers.current.add(item, pack ?? null);
          setJustAdded(`${item.name} · ${unitName(pack ?? null)}`);
        } else setMode({ kind: 'unit', variantId: item.variantId });
      } else handlers.current.add(item, hit);
    },
    [handlers, checkingRef, pickerAddedAt, setJustAdded, setMode],
  );
  const pickModel = useCallback(
    (productId: string, size?: { option: string; value: string }) => {
      if (Date.now() - pickerAddedAt.current < 350) return;
      if (checkingRef.current) {
        const model = pieces.get(productId);
        if (model)
          setCheck({
            name: model[0]!.productName ?? model[0]!.name,
            pieces: orderPieces(model),
            focus: null,
            packs: boxesOf(model),
          });
      } else {
        const model = pieces.get(productId);
        // A size chip tapped on a model whose only choice is the size: that piece goes in at once
        const only =
          size && model && optionsOf(model).length === 1
            ? pieceFor(model, { [size.option]: size.value }, 1)
            : null;
        if (only && (typeof only.stockQty !== 'number' || only.stockQty > 0)) {
          handlers.current.add(only, null);
          setJustAdded(only.name);
        } else
          setMode({ kind: 'pick', productId, ...(size ? { initial: { [size.option]: size.value } } : {}) });
      }
    },
    [pieces, boxesOf, handlers, checkingRef, pickerAddedAt, setCheck, setJustAdded, setMode],
  );
  return { pickItem, pickModel };
}
