import type { ReactNode } from 'react';
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
  /** Nothing to sell but still tappable (the till can sell below zero): the tile dims and says «غير متوفر» */
  soldOut?: boolean;
  /** Sold by weight: the price is per kilo. */
  weighed?: boolean;
  /** Has an active offer. */
  onOffer?: boolean;
  /** A short line under the name: how many sizes and colours a model has («3 خيارات»). */
  detail?: ReactNode;
  /**
   * Keep the picture's place when there is no photo, in a grid where other tiles have one: a soft
   * 4:3 square with the name's first letter, so the rows stay even.
   */
  pictureSlot?: boolean;
  /**
   * The name's first letter in a small soft square above the name: a model (sizes, colours) in a
   * grid with no photos at all, so it reads apart from single items at a glance.
   */
  initial?: boolean;
  /** An icon in the picture's place when there is no photo (instead of the name's first letter) */
  placeholder?: ReactNode;
  /** Words in place of the price («السعر عند البيع»: an item whose price is set at the sale) */
  priceLabel?: string;
  /** A small line under the price («≈ 5,850 ل.س»: a dollar price in the till's currency) */
  priceNote?: ReactNode;
  /** Small marks under the price (stock left, an expiry date, «برقم تسلسلي») */
  extra?: ReactNode;
  /** A tighter tile: a service with nothing to say but its name and fee, or the compact list density */
  compact?: boolean;
  onSelect: () => void;
  className?: string;
}

/** The first letter of a name, for the picture's place: «بنطال جينز» → «ب». */
function firstLetter(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

/**
 * A product on the sale screen (kit .item, tab 14 › بطاقة الصنف; هوية 4): a card at least 112 × 104,
 * the name on two lines, the price in equal-width digits with its unit softer. Selected (in the
 * cart) it takes the brand edge and tint; out of stock it dims and says «نفد»; a weighed item and
 * an offer carry a small mark at the price's end, with words for screen readers.
 */
export function ItemTile({
  name,
  priceMinor,
  currency,
  imageUrl,
  selected = false,
  outOfStock = false,
  soldOut = false,
  weighed = false,
  onOffer = false,
  detail,
  pictureSlot = false,
  initial = false,
  placeholder,
  priceLabel,
  priceNote,
  extra,
  compact = false,
  onSelect,
  className,
}: ItemTileProps) {
  const picture = Boolean(imageUrl) || pictureSlot;
  // No photo anywhere in the grid: the icon sits small beside the name (a ~110 high tile, not a grey box)
  const inlineIcon = !picture && Boolean(placeholder);
  const monogram = !picture && !inlineIcon && initial;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={outOfStock}
      aria-pressed={selected}
      className={cn(
        'flex min-w-28 flex-col rounded-card border text-start text-ink shadow-e1 select-none touch-manipulation',
        compact ? 'min-h-16 gap-1.5' : 'min-h-26 gap-3 max-sm:gap-2',
        'transition-[background-color,border-color,box-shadow,translate,scale] duration-120 ease-standard',
        'enabled:hover:shadow-e2 motion-safe:enabled:hover:-translate-y-0.5 motion-safe:enabled:active:scale-[0.98]',
        picture ? 'p-2 pb-3 max-sm:pb-2' : compact ? 'p-3' : 'p-3.5 max-sm:p-3',
        selected
          ? 'border-brand bg-brand-soft ring-1 ring-brand'
          : 'border-line bg-surface enabled:hover:border-line-control/50',
        outOfStock && 'cursor-not-allowed opacity-50',
        soldOut && !outOfStock && 'opacity-60',
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="aspect-[4/3] max-sm:aspect-[3/2] w-full rounded-control bg-surface-muted object-cover"
        />
      ) : pictureSlot ? (
        <span
          aria-hidden="true"
          className={cn(
            'grid aspect-[4/3] max-sm:aspect-[3/2] w-full place-items-center rounded-control text-2xl font-bold text-ink-subtle',
            selected ? 'bg-surface' : 'bg-surface-muted',
          )}
        >
          {placeholder ?? firstLetter(name)}
        </span>
      ) : null}
      {monogram ? (
        <span className="flex items-start justify-between gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-small text-lg font-bold text-brand-ink',
              selected ? 'bg-surface' : 'bg-brand-soft',
            )}
          >
            {firstLetter(name)}
          </span>
          {detail ? (
            <span className="rounded-small bg-surface-muted px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-ink-muted">
              {detail}
            </span>
          ) : null}
        </span>
      ) : null}
      {/* Two lines of name are always reserved, so the price sits at the same height on every tile of a row */}
      <span
        className={cn(
          'flex gap-0.5',
          inlineIcon ? 'flex-row items-start gap-2.5' : 'flex-col',
          !inlineIcon && !compact && (detail && !monogram ? 'min-h-[4rem]' : 'min-h-[2.75rem]'),
          picture && 'px-1.5',
        )}
      >
        {inlineIcon ? (
          <span
            aria-hidden="true"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-small text-ink-subtle',
              selected ? 'bg-surface' : 'bg-surface-muted',
            )}
          >
            {placeholder}
          </span>
        ) : null}
        <span
          className={cn(
            'line-clamp-2 min-w-0 text-base/[22px] font-semibold',
            inlineIcon && (compact ? 'flex-1' : 'min-h-[2.75rem] flex-1'),
          )}
        >
          <bdi>{name}</bdi>
        </span>
        {detail && !monogram && !inlineIcon ? <span className="text-sm text-ink-muted">{detail}</span> : null}
      </span>
      {detail && !monogram && inlineIcon ? <span className="text-sm text-ink-muted">{detail}</span> : null}
      <span className={cn('flex items-center justify-between gap-2', picture && 'px-1.5')}>
        {priceLabel ? (
          <span className="text-sm font-semibold text-ink-muted">{priceLabel}</span>
        ) : (
          <Money
            minor={priceMinor}
            currency={currency}
            className="text-base font-bold text-ink"
            unitClassName="text-xs font-semibold text-ink-subtle"
          />
        )}
        {outOfStock ? (
          <span className="text-xs font-semibold text-ink-muted">غير متوفر</span>
        ) : weighed || onOffer ? (
          <span className="flex items-center gap-1">
            {weighed ? (
              <span className="grid size-6 place-items-center rounded-small bg-surface-muted text-ink-muted">
                <WeighedIcon size={16} />
                <span className="sr-only">بالوزن</span>
              </span>
            ) : null}
            {onOffer ? (
              <span className="grid size-6 place-items-center rounded-small bg-accent-soft text-accent-ink">
                <OfferIcon size={16} />
                <span className="sr-only">عليه عرض</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      {priceNote ? (
        <span className={cn('-mt-2 text-xs text-ink-muted', picture && 'px-1.5')}>{priceNote}</span>
      ) : null}
      {extra ? (
        <span className={cn('flex flex-wrap items-center gap-1', picture && 'px-1.5')}>{extra}</span>
      ) : null}
    </button>
  );
}
