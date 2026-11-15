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
 * pressed. The last choice adds the piece (once, at the quantity set above; «أضف» stays for whoever
 * prefers it), unless that combination is out of stock: that one is shown as «نفد» and cannot be added.
 */
export function VariantPicker({
  name,
  pieces,
  inCart,
  priceNote,
  Kind,
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
  onAdd: (piece: CatalogItem, qty: number) => void;
  onCancel: () => void;
}) {
  const digits = useDigits();
  const idBase = useId();
  const options = optionsOf(pieces);
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    // An option with a single value («أبيض» only) starts chosen.
    Object.fromEntries(options.filter((o) => o.values.length === 1).map((o) => [o.name, o.values[0]!])),
  );
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
  const [qty, setQty] = useState(1);
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
    setChosen(next);
    const exact = pieceFor(pieces, next, options.length);
    // The last choice adds (unless the quantity was set by hand, or nothing is left of the piece)
    const done = Object.keys(next).length >= options.length;
    if (exact && done && !qtyTouched && (leftOf(exact) ?? 1) > 0) onAdd(exact, qty);
  }

  return (
    <SalePanel
      label={`اختر من ${name}`}
      className="mx-auto w-full max-w-lg lg:my-auto lg:max-w-xl lg:shadow-e3"
      title={name}
      subtitle={
        <>
          {piecesText(pieces.length)} · من <Money minor={from.priceMinor} currency={from.currency} />
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
          <Button size="lg" fullWidth icon={<AddIcon size={20} />} onClick={() => onAdd(piece, qty)}>
            {outOfStock ? (
              'نفد — أضفه رغم ذلك'
            ) : (
              <>
                أضف {(piece.attributes ?? []).map((a) => a.value).join(' ')} ·{' '}
                <Money minor={piece.price.priceMinor * qty} currency={piece.price.currency} />
              </>
            )}
          </Button>
        ) : undefined
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
                  minor={piece.price.priceMinor}
                  currency={piece.price.currency}
                  className="text-lg font-bold text-ink"
                />
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
        <div className="flex items-center gap-1" role="group" aria-label="الكمية">
          <IconButton
            label="أنقص الكمية"
            icon={<RemoveIcon size={20} />}
            disabled={qty <= 1}
            onClick={() => stepQty(-1)}
          />
          <output aria-label="عدد القطع" className="num min-w-8 text-center text-lg font-bold text-ink">
            {formatQuantity(qty * 1000, digits)}
          </output>
          <IconButton label="زد الكمية" icon={<AddIcon size={20} />} onClick={() => stepQty(1)} />
        </div>
      </div>
    </SalePanel>
  );
}
