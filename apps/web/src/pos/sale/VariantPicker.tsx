import { useId, useState, type ReactNode } from 'react';
import {
  AddIcon,
  Button,
  CloseIcon,
  cn,
  formatQuantity,
  IconButton,
  Money,
  RemoveIcon,
  TransferIcon,
  useDigits,
  type Icon,
} from '@serva/ui';
import type { CatalogItem } from '../catalog';
import { Kbd } from './Kbd';
import { canChoose, lowestPrice, optionsOf, pieceFor, piecesText, stockFor } from './models';
import { SalePanel } from './SalePanel';
import { isColourOption, swatchOf } from './swatch';

/**
 * «اختر المقاس واللون» (هوية 2; هوية 4): a model's pieces, picked beside the cart. Each option is a
 * row of large chips; a value no piece has with the other choices is struck through and cannot be
 * pressed. The last choice of a one-option model adds the piece (once, at the quantity set above); with
 * size and colour, «أضف إلى السلة» shows as soon as both are chosen and the cashier presses it, unless that combination is out of stock: that one is shown as «نفد» and cannot be added.
 */
export function VariantPicker({
  name,
  pieces,
  inCart,
  priceNote,
  Kind,
  initial,
  actionLabel = 'أضف إلى السلة',
  swap = false,
  fixedQty,
  onAdd,
  onCancel,
}: {
  name: string;
  pieces: readonly CatalogItem[];
  /** What the open cart already holds of each piece (thousandths), taken off the stock shown */
  inCart?: ReadonlyMap<string, number>;
  /** «≈ 5,850 ل.س» for a foreign price; null when none is needed */
  priceNote?: (minor: number, currency: CatalogItem['price']['currency']) => ReactNode;
  /** What the product is, drawn when it has no photo */
  Kind?: Icon;
  /** A choice made before the picker opened (the size chip tapped on the tile) */
  initial?: Readonly<Record<string, string>>;
  /** The add button's words: «بدّل في السلة» when a line's size or colour is being changed */
  actionLabel?: string;
  /** A line's size or colour is being swapped: a combination with nothing left cannot be chosen at all */
  swap?: boolean;
  /** A swap moves the whole line: its quantity (thousandths) shows as it is, with no stepper */
  fixedQty?: number;
  onAdd: (piece: CatalogItem, qty: number) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  const idBase = useId();
  const options = optionsOf(pieces);
  // An option with one value left (a colour the chosen size comes in alone) is chosen for the cashier
  // …and so is the only one that still has stock (the others are sold out): no dead end with no add button
  const settle = (picked: Record<string, string>): Record<string, string> => {
    const next = { ...picked };
    for (const other of options) {
      if (next[other.name]) continue;
      const open = other.values.filter((v) => canChoose(pieces, next, other.name, v));
      if (open.length === 1) next[other.name] = open[0]!;
      else if (open.length > 1 && options.length > 1) {
        const inStock = open.filter((v) => {
          const left = stockFor(pieces, next, other.name, v, inCart);
          return left === null || left > 0;
        });
        if (inStock.length === 1) next[other.name] = inStock[0]!;
      }
    }
    return next;
  };
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    // An option with a single value («أبيض» only) starts chosen.
    settle({
      ...Object.fromEntries(options.filter((o) => o.values.length === 1).map((o) => [o.name, o.values[0]!])),
      ...initial,
    }),
  );
  // How many options really have a choice (a colour with one value starts chosen)
  const choosable = options.filter((o) => o.values.length > 1).length;
  const piece = pieceFor(pieces, chosen, options.length);
  const image = (piece ?? pieces.find((p) => p.imageUrl))?.imageUrl ?? null;
  const from = lowestPrice(pieces);
  // The pieces still possible with what is chosen so far: their price shows as soon as the options narrow
  const narrowed = pieces.filter((p) =>
    Object.entries(chosen).every(([option, value]) =>
      (p.attributes ?? []).some((a) => a.name === option && a.value === value),
    ),
  );
  const narrowFrom = lowestPrice(narrowed.length > 0 ? narrowed : pieces);
  const samePrice = narrowed.every((p) => p.price.priceMinor === narrowFrom.priceMinor);
  const [typedQty, setQty] = useState(1);
  const fixed = fixedQty !== undefined;
  const qty = fixed ? fixedQty / 1000 : typedQty;
  const [qtyTouched, setQtyTouched] = useState(false);
  const stepQty = (delta: number) => {
    setQtyTouched(true);
    setQty((q) => Math.min(999, Math.max(1, q + delta)));
  };
  // A combination with nothing left is not added by the last choice: «أضفه رغم ذلك» asks for it (the stock known at this till, less the cart)
  const leftOf = (p: CatalogItem | null) =>
    p && typeof p.stockQty === 'number' ? p.stockQty - (inCart?.get(p.variantId) ?? 0) : null;
  const outOfStock = piece ? (leftOf(piece) ?? 1) <= 0 : false;

  function choose(option: string, value: string) {
    const next = { ...chosen, [option]: value };
    // A choice that no longer fits the new value is dropped («XL» after picking a colour without it).
    for (const other of options) {
      if (
        other.name !== option &&
        next[other.name] &&
        !canChoose(pieces, next, other.name, next[other.name]!)
      ) {
        delete next[other.name];
      }
    }
    const settled = settle(next);
    Object.assign(next, settled);
    setChosen(next);
    const exact = pieceFor(pieces, next, options.length);
    // Only a model with ONE thing to choose (sizes alone, or a colour with a single size) adds on its last choice.
    // With two (size and colour) the last choice shows «أضف إلى السلة» and waits: a wrong tap must never add a wrong line silently
    const done = Object.keys(next).length >= options.length;
    if (choosable <= 1 && exact && done && !qtyTouched && (leftOf(exact) ?? 1) > 0) onAdd(exact, qty);
  }

  return (
    <SalePanel
      label={`اختر من ${name}`}
      className="mx-auto w-full max-w-lg lg:my-auto lg:max-w-xl lg:shadow-e3"
      title={name}
      subtitle={
        <>
          {piecesText(pieces.length)} ·{' '}
          {pieces.every((p) => p.price.priceMinor === from.priceMinor) ? null : 'من '}
          <Money minor={from.priceMinor} currency={from.currency} />
          {priceNote?.(from.priceMinor, from.currency) ? (
            <> {priceNote(from.priceMinor, from.currency)}</>
          ) : null}
        </>
      }
      media={
        image ? (
          <img
            src={image}
            alt=""
            className="size-12 shrink-0 rounded-control bg-surface-muted object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-control bg-brand-soft text-2xl font-bold text-brand-ink"
          >
            {Kind ? <Kind size={24} /> : (Array.from(name.trim())[0] ?? '')}
          </span>
        )
      }
      actions={
        <Button
          variant="secondary"
          size="md"
          icon={<CloseIcon size={20} />}
          aria-keyshortcuts="Escape"
          onClick={onCancel}
        >
          إلغاء
          <Kbd>Esc</Kbd>
        </Button>
      }
      footer={
        piece ? (
          <Button
            size="lg"
            fullWidth
            icon={swap ? <TransferIcon size={20} /> : <AddIcon size={20} />}
            onClick={() => onAdd(piece, qty)}
            disabled={swap && outOfStock}
            className="h-auto py-2 whitespace-normal"
          >
            {outOfStock ? (
              swap ? (
                'نفد — اختر غيره'
              ) : (
                'نفد — أضفه رغم ذلك'
              )
            ) : (
              <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-2">
                <span>{actionLabel}</span>
                <span className="whitespace-nowrap">
                  {(piece.attributes ?? []).map((a) => a.value).join(' ')} ·{' '}
                  {fixed ? <>{formatQuantity(fixedQty, digits)} × </> : null}
                  <Money minor={Math.round(piece.price.priceMinor * qty)} currency={piece.price.currency} />
                </span>
              </span>
            )}
          </Button>
        ) : (
          // Never an empty slot: what is still to choose is said on a disabled button
          <Button size="lg" fullWidth icon={<AddIcon size={20} />} disabled>
            اختر{' '}
            {options
              .filter((o) => !chosen[o.name])
              .map((o) => o.name)
              .join(' و') || actionLabel}
          </Button>
        )
      }
    >
      {options.map((option) => {
        // The count shows once: under the sizes (or the only option), not again under every colour
        // …and under the colours too once a size is chosen, so «نفد» shows for the combination
        const otherChosen = Object.keys(chosen).some((k) => k !== option.name);
        const showStock = options.length === 1 || !isColourOption(option.name) || otherChosen;
        return (
          <div key={option.name} role="group" aria-label={option.name} className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
              {option.name}
              {chosen[option.name] ? (
                <span className="font-normal text-ink-subtle">· {chosen[option.name]}</span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const on = chosen[option.name] === value;
                const possible = canChoose(pieces, { ...chosen, [option.name]: value }, option.name, value);
                const left = stockFor(pieces, chosen, option.name, value, inCart);
                const stockId = `${idBase}-${option.name}-${value}`;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    aria-label={value}
                    aria-describedby={left === null || !possible ? undefined : stockId}
                    disabled={!possible}
                    onClick={() => choose(option.name, value)}
                    className={cn(
                      'min-h-12 min-w-16 rounded-small border px-4 text-base font-semibold transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard select-none',
                      on
                        ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand'
                        : possible && left !== null && left <= 0 && options.length > 1 && otherChosen
                          ? 'border-line-control/60 bg-surface-muted text-ink-muted'
                          : possible
                            ? 'border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted'
                            : 'cursor-not-allowed border-dashed border-line-control/50 text-ink-subtle line-through',
                    )}
                  >
                    <span aria-hidden="true" className="flex flex-col items-center leading-tight">
                      <span className="flex items-center gap-2">
                        {isColourOption(option.name) && swatchOf(value) ? (
                          <span
                            className="size-4 shrink-0 rounded-full border border-line-control/60"
                            style={{ backgroundColor: swatchOf(value)! }}
                          />
                        ) : null}
                        <span
                          className={cn(
                            possible &&
                              left !== null &&
                              left <= 0 &&
                              showStock &&
                              'line-through decoration-2',
                          )}
                        >
                          {value}
                        </span>
                      </span>
                      {left !== null && possible && showStock ? (
                        <span
                          className={cn(
                            'num text-xs font-semibold',
                            left <= 0 ? 'text-danger-ink' : 'text-ink-muted',
                          )}
                        >
                          {left <= 0 ? 'نفد' : formatQuantity(left, digits)}
                        </span>
                      ) : null}
                    </span>
                    {left !== null && possible ? (
                      <span id={stockId} className="sr-only">
                        {left <= 0 ? 'نفد' : `المتوفر ${formatQuantity(left, digits)}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div
        aria-label="الاختيار والكمية"
        role="group"
        className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-surface-muted/60 px-4 py-3"
      >
        <p className="flex min-w-0 flex-col text-sm text-ink-muted">
          {piece ? (
            <>
              <span className="flex flex-wrap items-baseline gap-2">
                <Money
                  minor={Math.round(piece.price.priceMinor * qty)}
                  currency={piece.price.currency}
                  className="text-lg font-bold text-ink"
                />
                {fixed ? (
                  <span className="num text-ink-muted">
                    {formatQuantity(fixedQty, digits)} ×{' '}
                    <Money minor={piece.price.priceMinor} currency={piece.price.currency} />
                  </span>
                ) : null}
                {priceNote?.(piece.price.priceMinor, piece.price.currency)}
              </span>
              {outOfStock ? <span className="font-semibold text-danger-ink">نفد هذا الاختيار</span> : null}
            </>
          ) : narrowed.length > 0 ? (
            <span className="flex flex-wrap items-baseline gap-2">
              {samePrice ? null : <span>من</span>}
              <Money
                minor={narrowFrom.priceMinor}
                currency={narrowFrom.currency}
                className="text-lg font-bold text-ink"
              />
              {priceNote?.(narrowFrom.priceMinor, narrowFrom.currency)}
            </span>
          ) : (
            <span>اختر كل الخيارات لترى السعر</span>
          )}
        </p>
        {/* − 1 + from the left, as on every keypad and number box, whatever the page's direction */}
        {fixed ? (
          <output aria-label="عدد القطع" className="num text-lg font-bold text-ink">
            {formatQuantity(fixedQty, digits)} قطع
          </output>
        ) : (
          <div dir="ltr" className="flex items-center gap-1" role="group" aria-label="الكمية">
            {/* Never dimmed: at one piece it simply stays at one */}
            <IconButton label="أنقص الكمية" icon={<RemoveIcon size={20} />} onClick={() => stepQty(-1)} />
            <output aria-label="عدد القطع" className="num min-w-8 text-center text-lg font-bold text-ink">
              {formatQuantity(qty * 1000, digits)}
            </output>
            <IconButton label="زد الكمية" icon={<AddIcon size={20} />} onClick={() => stepQty(1)} />
          </div>
        )}
      </div>
    </SalePanel>
  );
}
