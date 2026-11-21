import { useMemo, useState } from 'react';
import type { HallChoice, HallLineInput, HallMenuItem } from '@serva/core';
import { Alert, Badge, Button, cn, Money, SearchField, TextField } from '@serva/ui';
import type { CurrencyCode } from '@serva/core/currencies';
import { normalizeArabic } from '@serva/core/text';
import { lineTotalMinor } from '../format';

/** A line the waiter has chosen but not yet put on the order */
export interface DraftLine extends HallLineInput {
  key: number;
  priceMinor: number;
  choices: HallChoice[];
}

function ItemForm({
  item,
  currency,
  onAdd,
  onCancel,
}: {
  item: HallMenuItem;
  currency: CurrencyCode;
  onAdd: (line: Omit<DraftLine, 'key'>) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState('');
  const [seat, setSeat] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggle(group: string, option: string, multiple: boolean) {
    setPicked((p) => {
      const now = p[group] ?? [];
      const next = multiple
        ? now.includes(option)
          ? now.filter((o) => o !== option)
          : [...now, option]
        : [option];
      return { ...p, [group]: next };
    });
  }

  const choices: HallChoice[] = item.modifiers.flatMap((group) =>
    (picked[group.name] ?? []).flatMap((name) => {
      const option = group.options.find((o) => o.name === name);
      return option ? [{ group: group.name, name, priceMinor: option.priceMinor }] : [];
    }),
  );

  function add() {
    const missing = item.modifiers.find((g) => g.required && (picked[g.name] ?? []).length === 0);
    if (missing) {
      setError(`اختر من «${missing.name}».`);
      return;
    }
    const seatNo = seat.trim() === '' ? null : Number(seat);
    if (seatNo !== null && (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 30)) {
      setError('رقم المقعد بين 1 و30.');
      return;
    }
    const extra = [...choices.map((c) => c.name), ...(note.trim() ? [note.trim()] : [])];
    onAdd({
      productId: item.productId,
      variantId: item.variantId,
      name: [item.name, ...extra].join(' · '),
      qty,
      choices,
      note: note.trim() || null,
      seat: seatNo,
      priceMinor: item.priceMinor,
    });
  }

  return (
    <section aria-label={`خيارات ${item.name}`} className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">{item.name}</h2>
      {item.modifiers.map((group) => (
        <fieldset key={group.name} className="flex flex-col gap-2">
          <legend className="mb-1 flex items-center gap-2 font-semibold">
            {group.name}
            {group.required ? <Badge tone="warning">مطلوب</Badge> : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {group.options.map((option) => {
              const on = (picked[group.name] ?? []).includes(option.name);
              return (
                <button
                  key={option.name}
                  type="button"
                  role={group.multiple ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(group.name, option.name, group.multiple)}
                  className={cn(
                    'min-h-12 rounded-control border px-4 text-base font-semibold',
                    on
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line-control bg-surface text-ink',
                  )}
                >
                  {option.name}
                  {option.priceMinor > 0 ? (
                    <Money minor={option.priceMinor} currency={currency} className="ms-2 text-sm" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <span className="font-semibold">الكمية</span>
        <Button
          variant="secondary"
          size="lg"
          aria-label="أنقص"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
        >
          −
        </Button>
        <span className="num min-w-8 text-center text-2xl font-bold" aria-label="الكمية">
          {qty}
        </span>
        <Button
          variant="secondary"
          size="lg"
          aria-label="زِد"
          onClick={() => setQty((q) => Math.min(99, q + 1))}
        >
          +
        </Button>
      </div>
      <TextField
        label="ملاحظة للمطبخ"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
      />
      <TextField
        label="رقم المقعد"
        inputMode="numeric"
        value={seat}
        onChange={(e) => setSeat(e.target.value.replace(/\D/g, '').slice(0, 2))}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-3">
        <Button size="lg" className="flex-1" onClick={add}>
          أضف · <Money minor={lineTotalMinor(item.priceMinor, choices, qty)} currency={currency} />
        </Button>
        <Button variant="secondary" size="lg" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </section>
  );
}

/**
 * Picking items for a table: sections as chips, a search box, the items with their prices. An item
 * opens its choices (size, extras), the note and the seat; the picks wait in a draft until «أضف
 * للطلب» puts them all on the order in one go.
 */
export function AddItemView({
  items,
  currency,
  draft,
  setDraft,
  onDone,
  onBack,
}: {
  items: readonly HallMenuItem[];
  currency: CurrencyCode;
  draft: readonly DraftLine[];
  setDraft: (next: DraftLine[]) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<HallMenuItem | null>(null);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const shown = useMemo(() => {
    const q = normalizeArabic(query);
    return items.filter(
      (i) => (!category || i.category === category) && (q === '' || normalizeArabic(i.name).includes(q)),
    );
  }, [items, query, category]);

  if (open) {
    return (
      <ItemForm
        item={open}
        currency={currency}
        onCancel={() => setOpen(null)}
        onAdd={(line) => {
          setDraft([...draft, { ...line, key: (draft.at(-1)?.key ?? 0) + 1 }]);
          setOpen(null);
        }}
      />
    );
  }

  return (
    <section aria-label="إضافة أصناف" className="flex flex-col gap-3">
      <SearchField label="ابحث عن صنف" placeholder="ابحث عن صنف" value={query} onValueChange={setQuery} />
      <div role="group" aria-label="الأقسام" className="flex gap-2 overflow-x-auto pb-1">
        <Button size="md" variant={category ? 'secondary' : 'primary'} onClick={() => setCategory(null)}>
          الكل
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            size="md"
            variant={category === c ? 'primary' : 'secondary'}
            className="shrink-0"
            onClick={() => setCategory(c)}
          >
            {c}
          </Button>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.variantId}>
            <button
              type="button"
              onClick={() => setOpen(item)}
              className="flex min-h-14 w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-2 text-start shadow-e1"
            >
              <span className="min-w-0 flex-1 text-lg font-semibold">{item.name}</span>
              <Money minor={item.priceMinor} currency={currency} className="text-base text-ink-muted" />
            </button>
          </li>
        ))}
      </ul>
      {draft.length > 0 ? (
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3">
          <ul aria-label="الأصناف المختارة" className="flex flex-col gap-1 text-sm">
            {draft.map((line) => (
              <li key={line.key} className="flex items-center gap-2">
                <span className="num font-bold">{line.qty}×</span>
                <span className="min-w-0 flex-1 truncate">{line.name}</span>
                <button
                  type="button"
                  aria-label={`احذف ${line.name}`}
                  className="min-h-10 min-w-10 text-danger-ink"
                  onClick={() => setDraft(draft.filter((d) => d.key !== line.key))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <Button size="lg" onClick={onDone}>
            أضف للطلب ({draft.length})
          </Button>
        </div>
      ) : null}
      <Button variant="ghost" size="lg" onClick={onBack}>
        رجوع إلى الطاولة
      </Button>
    </section>
  );
}
