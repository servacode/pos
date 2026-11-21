import { useEffect, useMemo, useState } from 'react';
import type { Category, SectorKey } from '@serva/core';
import { Alert, Button, Dialog, Select } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { suggestFor } from '../../lib/categorySuggest';
import { createCategory, updateProduct } from '../catalog/api';

/** What the dialog needs to know about a product */
export interface CategorizeItem {
  id: string;
  nameAr: string;
  version: number;
  categoryId: string | null;
}

const KEEP = '';
const NEW = 'new:';

interface CategorizeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Done: how many products got a category (the list reloads) */
  onDone: (changed: number, createdCategories: number) => void;
  products: readonly CategorizeItem[];
  categories: readonly Category[];
  sectors: readonly SectorKey[];
}

/**
 * «صنّف المحددة» / «صنّف تلقائياً»: a category is proposed for each product from its name, the owner
 * reviews and changes any of them, and only then are the categories created and the products moved.
 */
export function CategorizeDialog({
  open,
  onClose,
  onDone,
  products,
  categories,
  sectors,
}: CategorizeDialogProps) {
  const proposals = useMemo(
    () =>
      products.map((p) => {
        const hit = suggestFor(p.nameAr, categories, sectors);
        const value = hit ? (hit.categoryId ?? `${NEW}${hit.newName ?? ''}`) : KEEP;
        return [p.id, value] as const;
      }),
    [products, categories, sectors],
  );
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChoice(Object.fromEntries(proposals));
      setError(null);
    }
  }, [open, proposals]);

  const liveCategories = categories.filter((c) => !c.archivedAt);
  // Every new category the names suggested (kept in the lists even when none is chosen for now)
  const offered = [
    ...new Set(proposals.filter(([, v]) => v.startsWith(NEW)).map(([, v]) => v.slice(NEW.length))),
  ];
  // The categories the proposals would create, once each
  const newNames = [
    ...new Set(
      Object.values(choice)
        .filter((v) => v.startsWith(NEW))
        .map((v) => v.slice(NEW.length)),
    ),
  ];
  const picked = products.filter((p) => (choice[p.id] ?? KEEP) !== KEEP);
  // A name the dictionary does not know stays as it is: the rest are applied all the same
  const unproposed = products.length - picked.length;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const ids = new Map<string, string>();
      for (const [i, name] of newNames.entries()) {
        const made = await createCategory({ name, parentId: null, sortOrder: liveCategories.length + i });
        ids.set(name, made.id);
      }
      let changed = 0;
      for (const p of picked) {
        const value = choice[p.id] ?? KEEP;
        const categoryId = value.startsWith(NEW) ? ids.get(value.slice(NEW.length)) : value;
        if (!categoryId) continue;
        await updateProduct(p.id, { version: p.version, categoryId });
        changed += 1;
      }
      onDone(changed, newNames.length);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="صنّف المنتجات"
      description="اقترحنا تصنيفاً لكل منتج من اسمه. غيّر ما لا يناسبك، ثم اضغط «طبّق»."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={picked.length === 0}
            onClick={() => void apply()}
          >
            {picked.length > 0 ? `طبّق على ${String(picked.length)}` : 'طبّق'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {newNames.length > 0 ? (
          <p className="text-sm text-ink-muted">
            سنُنشئ هذه التصنيفات: <span className="font-semibold text-ink">{newNames.join('، ')}</span>
          </p>
        ) : null}
        {picked.length > 0 && unproposed > 0 ? (
          <p className="text-sm text-ink-muted">
            {unproposed === 1 ? 'منتج واحد' : `${String(unproposed)} منتجات`} بلا اقتراح: يبقى كما هو، أو اختر
            له تصنيفاً بنفسك. «طبّق» يُصنّف الباقي.
          </p>
        ) : null}
        {products.length === 0 ? <p className="text-ink-muted">لا منتجات للتصنيف.</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {products.map((p) => {
            const value = choice[p.id] ?? KEEP;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 basis-40 font-semibold">{p.nameAr}</span>
                <Select
                  label={`تصنيف «${p.nameAr}»`}
                  hideLabel
                  value={value}
                  onChange={(event) => setChoice((c) => ({ ...c, [p.id]: event.target.value }))}
                  className="min-w-44 flex-1 basis-44"
                >
                  <option value={KEEP}>بلا تصنيف</option>
                  {liveCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  {offered.map((n) => (
                    <option key={n} value={`${NEW}${n}`}>
                      {n} (جديد)
                    </option>
                  ))}
                </Select>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
