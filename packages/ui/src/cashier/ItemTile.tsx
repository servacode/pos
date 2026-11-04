import type { CurrencyId } from '@serva/core';
import { cn } from '../cn';
import { OfferIcon, WeighedIcon } from '../icons';
import { Money } from '../Money';

export interface ItemTileProps {
  name: string;
  priceMinor: number;
  currency: CurrencyId;
  /** A photo above the name. Without one the tile is the kit's: name and price only. */
  imageUrl?: string;
  selected?: boolean;
  outOfStock?: boolean;
  /** Sold by weight: the price is per kilo. */
  weighed?: boolean;
  /** Has an active offer. */
  onOffer?: boolean;
  /** A short line under the name: how many sizes and colours a model has («3 خيارات»). */
  detail?: string;
  /** Keep the picture's place when there is no photo: a soft square with the name's first letter. */
  pictureSlot?: boolean;
  onSelect: () => void;
  className?: string;
}

/**
 * A product on the sale screen (kit .item, tab 14 › بطاقة الصنف): at least 112 × 104, the name on two
 * lines, the price in equal-width digits; selected, out of stock, weighed or on offer.
 */
export function ItemTile({
  name,
  priceMinor,
  currency,
  imageUrl,
  selected = false,
  outOfStock = false,
  weighed = false,
  onOffer = false,
  detail,
  pictureSlot = false,
  onSelect,
  className,
}: ItemTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={outOfStock}
      aria-pressed={selected}
      className={cn(
        'flex min-h-26 min-w-28 flex-col justify-between gap-2 rounded-card border text-start text-ink shadow-e1 transition-[border-color,background-color,box-shadow,transform] duration-80 ease-standard select-none hover:shadow-e2 active:scale-[0.98]',
        imageUrl || pictureSlot ? 'p-2 pb-3' : 'p-3.5',
        selected ? 'border-2 border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-control',
        outOfStock && 'cursor-not-allowed opacity-50 active:scale-100',
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="aspect-[4/3] w-full rounded-control bg-surface-muted object-cover"
        />
      ) : pictureSlot ? (
        <span
          aria-hidden="true"
          className="grid aspect-[4/3] w-full place-items-center rounded-control bg-brand-soft text-3xl font-bold text-brand-ink/70"
        >
          {Array.from(name.trim())[0] ?? ''}
        </span>
      ) : null}
      <span className={cn('flex flex-col gap-0.5', (imageUrl || pictureSlot) && 'px-1.5')}>
        <span className="line-clamp-2 text-base/[22px] font-semibold">
          <bdi>{name}</bdi>
        </span>
        {detail ? <span className="text-[0.8125rem] text-ink-muted">{detail}</span> : null}
      </span>
      <span className={cn('flex items-center justify-between gap-2', (imageUrl || pictureSlot) && 'px-1.5')}>
        <Money
          minor={priceMinor}
          currency={currency}
          className="text-[0.9375rem] font-semibold text-brand-ink"
        />
        {outOfStock ? (
          <span className="text-xs font-semibold text-ink-muted">نفد</span>
        ) : (
          <span className="flex items-center gap-1 text-ink-muted">
            {weighed ? (
              <>
                <WeighedIcon size={16} />
                <span className="sr-only">بالوزن</span>
              </>
            ) : null}
            {onOffer ? (
              <>
                <OfferIcon size={16} />
                <span className="sr-only">عليه عرض</span>
              </>
            ) : null}
          </span>
        )}
      </span>
    </button>
  );
}
