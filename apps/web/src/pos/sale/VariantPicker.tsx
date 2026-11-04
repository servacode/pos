import { useState } from 'react';
import { Button, cn, Money } from '@serva/ui';
import type { CatalogItem } from '../catalog';
import { canChoose, optionsOf, pieceFor } from './models';

/**
 * «اختر المقاس واللون» (هوية 2): a model's pieces, picked beside the cart. A value no piece has with
 * the other choices is struck through. A model with one option (sizes only) adds on the first tap;
 * with two, «أضف» names the piece and its price.
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
    <section
      aria-label={`اختر من ${name}`}
      className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e2"
    >
      <div className="flex items-center gap-4">
        {image ? <img src={image} alt="" className="size-18 shrink-0 rounded-control object-cover" /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-lg font-bold text-ink">{name}</h2>
          <p className="text-sm text-ink-muted">اختر {options.map((o) => o.name).join(' و')}</p>
        </div>
      </div>
      {options.map((option) => (
        <div key={option.name} role="group" aria-label={option.name} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink-muted">{option.name}</p>
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
                    'min-h-12 min-w-14 rounded-control border px-4 font-semibold transition-colors duration-120',
                    on
                      ? 'border-brand bg-brand text-on-brand'
                      : 'border-line-control bg-surface text-ink hover:bg-surface-muted',
                    !possible && 'cursor-not-allowed border-dashed text-ink-subtle line-through opacity-60',
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex gap-3">
        <Button className="flex-1" disabled={!piece} onClick={() => piece && onAdd(piece)}>
          {piece ? (
            <>
              أضف {(piece.attributes ?? []).map((a) => a.value).join(' ')} ·{' '}
              <Money minor={piece.price.priceMinor} currency={piece.price.currency} />
            </>
          ) : (
            'اختر لتضيف'
          )}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </section>
  );
}
