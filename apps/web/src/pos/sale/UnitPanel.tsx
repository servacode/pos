import { packPrice } from '@serva/core/sale';
import { Button, CloseIcon, cn, formatQuantity, Money, ProductsIcon, useDigits } from '@serva/ui';
import type { BarcodeHit, CatalogItem } from '../catalog';
import { pieceWord } from './packText';
import { SalePanel } from './SalePanel';

/**
 * «الوحدة» (03 › الأدوات الطبية): an item sold by the piece and by the box is picked from the grid
 * with no barcode to scan, so the till asks which one goes into the cart: the piece, or each box
 * the item has (its pack barcodes). Each shows its own price.
 */
export function UnitPanel({
  item,
  packs,
  lastUnit,
  onPick,
  onCancel,
}: {
  item: CatalogItem;
  /** The item's pack barcodes (more than one piece), each a box size */
  packs: readonly BarcodeHit[];
  /** What was picked last time for this item: 'piece' or a pack barcode's id; shown first */
  lastUnit?: string;
  /** `null`: the single piece */
  onPick: (hit: BarcodeHit | null) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  // The unit used last time comes first
  const units = [
    { id: 'piece', hit: null as BarcodeHit | null, priceMinor: item.price.priceMinor },
    ...packs.map((hit) => ({
      id: hit.barcode.id,
      hit: hit as BarcodeHit | null,
      priceMinor: packPrice(item.price.priceMinor, hit.barcode.packQty, hit.barcode.packPriceMinor),
    })),
  ].sort((x, y) => Number(y.id === lastUnit) - Number(x.id === lastUnit));
  return (
    <SalePanel
      label="اختر الوحدة"
      className="mx-auto w-full max-w-sm lg:my-auto lg:shadow-e3"
      title={item.name}
      subtitle="بالقطعة أو بالعلبة؟"
      icon={<ProductsIcon size={20} />}
      actions={
        <Button variant="ghost" icon={<CloseIcon size={20} />} onClick={onCancel}>
          إلغاء
        </Button>
      }
    >
      <ul aria-label="الوحدات" className="flex flex-col gap-2">
        {units.map((unit) => (
          <li key={unit.id}>
            <button
              type="button"
              onClick={() => onPick(unit.hit)}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-control border bg-surface px-4 py-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted active:bg-surface-muted',
                unit.id === lastUnit ? 'border-brand ring-1 ring-brand' : 'border-line',
              )}
            >
              <span className="min-w-0 flex-1 font-semibold text-ink">
                {unit.hit ? (
                  <>
                    {unit.hit.barcode.packName ? <bdi>{unit.hit.barcode.packName}</bdi> : 'علبة'}{' '}
                    <span className="text-sm font-normal text-ink-muted">
                      ({formatQuantity(unit.hit.barcode.packQty, digits)}{' '}
                      {pieceWord(unit.hit.barcode.packQty)})
                    </span>
                  </>
                ) : (
                  'قطعة واحدة'
                )}
                {unit.id === lastUnit ? (
                  <span className="ms-2 text-xs font-normal text-ink-muted">آخر مرة</span>
                ) : null}
              </span>
              <Money minor={unit.priceMinor} currency={item.price.currency} className="font-bold" />
            </button>
          </li>
        ))}
      </ul>
    </SalePanel>
  );
}
