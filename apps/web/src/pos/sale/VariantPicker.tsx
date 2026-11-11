import { useState } from 'react';
import { AddIcon, Button, CloseIcon, cn, CONTROL_HEIGHT, Money } from '@serva/ui';
import type { CatalogItem } from '../catalog';
import { Kbd } from './Kbd';
import { canChoose, lowestPrice, optionsOf, pieceFor, piecesText } from './models';
import { SalePanel } from './SalePanel';

/**
 * «اختر المقاس واللون» (هوية 2; هوية 4): a model's pieces, picked beside the cart. Each option is a
 * row of large chips; a value no piece has with the other choices is struck through and cannot be
 * pressed. A model with one option (sizes only) adds on the first tap; with two, «أضف» names the
 * piece and its price.
 */
export function VariantPicker({
  name,
  pieces,
  onAdd,
  onCancel,
}: {
  name: string;
  pieces: readonly CatalogItem[];
  onAdd: (piece: CatalogItem) => void;
  onCancel: () => void;
}) {
  const options = optionsOf(pieces);
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    // An option with a single value («أبيض» only) starts chosen.
    Object.fromEntries(options.filter((o) => o.values.length === 1).map((o) => [o.name, o.values[0]!])),
  );
  const piece = pieceFor(pieces, chosen, options.length);
  const image = (piece ?? pieces.find((p) => p.imageUrl))?.imageUrl ?? null;
  const from = lowestPrice(pieces);

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
    if (exact && options.filter((o) => o.values.length > 1).length === 1) onAdd(exact);
  }

  return (
    <SalePanel
      label={`اختر من ${name}`}
      title={name}
      subtitle={
        <>
          {piecesText(pieces.length)} · من <Money minor={from.priceMinor} currency={from.currency} />
        </>
      }
      media={
        image ? (
          <img src={image} alt="" className="size-14 shrink-0 rounded-control bg-surface-muted object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-control bg-brand-soft text-2xl font-bold text-brand-ink"
          >
            {Array.from(name.trim())[0] ?? ''}
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
        <Button
          size="lg"
          fullWidth
          icon={<AddIcon size={20} />}
          disabled={!piece}
          onClick={() => piece && onAdd(piece)}
        >
          {piece ? (
            <>
              أضف {(piece.attributes ?? []).map((a) => a.value).join(' ')} ·{' '}
              <Money minor={piece.price.priceMinor} currency={piece.price.currency} />
            </>
          ) : (
            'اختر لتضيف'
          )}
        </Button>
      }
    >
      {options.map((option) => (
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
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  disabled={!possible}
                  onClick={() => choose(option.name, value)}
                  className={cn(
                    CONTROL_HEIGHT.touch,
                    'min-w-16 rounded-small border px-4 text-lg font-semibold transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard select-none',
                    on
                      ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand'
                      : possible
                        ? 'border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted'
                        : 'cursor-not-allowed border-dashed border-line-control/50 text-ink-subtle line-through',
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </SalePanel>
  );
}
