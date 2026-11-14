import { packPrice } from '@serva/core/sale';
import { Button, CloseIcon, formatQuantity, Money, ProductsIcon, useDigits } from '@serva/ui';
import type { BarcodeHit, CatalogItem } from '../catalog';
import { SalePanel } from './SalePanel';

/**
 * «الوحدة» (03 › الأدوات الطبية): an item sold by the piece and by the box is picked from the grid
 * with no barcode to scan, so the till asks which one goes into the cart: the piece, or each box
 * the item has (its pack barcodes). Each shows its own price.
 */
export function UnitPanel({
  item,
  packs,
  onPick,
  onCancel,
}: {
  item: CatalogItem;
  /** The item's pack barcodes (more than one piece), each a box size */
  packs: readonly BarcodeHit[];
  /** `null`: the single piece */
  onPick: (hit: BarcodeHit | null) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  return (
    <SalePanel
      label="اختر الوحدة"
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
        <li>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex min-h-14 w-full items-center gap-3 rounded-control border border-line bg-surface px-4 py-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted active:bg-surface-muted"
          >
            <span className="min-w-0 flex-1 font-semibold text-ink">قطعة واحدة</span>
            <Money minor={item.price.priceMinor} currency={item.price.currency} className="font-bold" />
          </button>
        </li>
        {packs.map((hit) => (
          <li key={hit.barcode.id}>
            <button
              type="button"
              onClick={() => onPick(hit)}
              className="flex min-h-14 w-full items-center gap-3 rounded-control border border-line bg-surface px-4 py-2 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted active:bg-surface-muted"
            >
              <span className="min-w-0 flex-1 font-semibold text-ink">
                {hit.barcode.packName ? <bdi>{hit.barcode.packName}</bdi> : 'علبة'}{' '}
                <span className="text-sm font-normal text-ink-muted">
                  ({formatQuantity(hit.barcode.packQty, digits)} قطعة)
                </span>
              </span>
              <Money
                minor={packPrice(item.price.priceMinor, hit.barcode.packQty, hit.barcode.packPriceMinor)}
                currency={item.price.currency}
                className="font-bold"
              />
            </button>
          </li>
        ))}
      </ul>
    </SalePanel>
  );
}
