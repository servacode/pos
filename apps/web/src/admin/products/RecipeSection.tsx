import { useCallback, useEffect, useState } from 'react';
import type { Recipe, RecipeItem } from '@serva/core';
import { Alert, Button, GiftIcon, Money, SearchField, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { apiFetch, errorMessage } from '../../lib/api';
import { getProduct, listProducts } from '../catalog/api';
import { SectionCard } from './parts';

/**
 * «الوصفة» of a menu item (03 › المطاعم): what goes into one portion, to show the dish's food cost
 * in «كلفة الوجبات». It never deducts stock and posts nothing. Saved on its own.
 */

const recipePath = (productId: string) => `/v1/recipes/${productId}`;

interface Row {
  variantId: string;
  name: string;
  unitSymbol: string | null;
  /** In the ingredient's own unit, as typed («0.2» kg) */
  qty: string;
  costMinor: number | null;
}

const toRow = (i: RecipeItem): Row => ({
  variantId: i.variantId,
  name: i.name,
  unitSymbol: i.unitSymbol,
  qty: String(i.qty / 1000),
  costMinor: i.costMinor,
});

/** «0.2» → 200 thousandths; null when it is not a positive amount */
export function thousandths(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  const q = Math.round(n * 1000);
  return Number.isFinite(n) && q > 0 ? q : null;
}

export function RecipeSection({ productId, disabled = false }: { productId: string; disabled?: boolean }) {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Recipe>(recipePath(productId), { auth: true });
      setRecipe(r);
      setRows(r.items.map(toRow));
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void listProducts({ q, limit: 6 })
        .then((res) => {
          if (alive)
            setFound(res.items.filter((p) => p.id !== productId).map((p) => ({ id: p.id, name: p.nameAr })));
        })
        .catch(() => alive && setFound([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, productId]);

  async function add(id: string) {
    setSearch('');
    setFound([]);
    try {
      const p = await getProduct(id);
      const v = p.variants.find((x) => !x.archivedAt) ?? p.variants[0];
      if (!v || rows.some((r) => r.variantId === v.id)) return;
      setRows((now) => [
        ...now,
        {
          variantId: v.id,
          name: v.label ? `${p.nameAr} · ${v.label}` : p.nameAr,
          unitSymbol: null,
          qty: '',
          costMinor: null,
        },
      ]);
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    }
  }

  async function save() {
    const items = rows.map((r) => ({ variantId: r.variantId, qty: thousandths(r.qty) }));
    if (items.some((i) => i.qty === null)) {
      setMessage({ tone: 'error', text: 'اكتب كمية كل مكوّن بأكثر من صفر.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await apiFetch<Recipe>(recipePath(productId), {
        method: 'PUT',
        auth: true,
        body: { items },
      });
      setRecipe(saved);
      setRows(saved.items.map(toRow));
      setMessage({ tone: 'success', text: 'حُفظت الوصفة.' });
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="الوصفة وكلفة الوجبة"
      icon={<GiftIcon />}
      description="مكوّنات الحصة الواحدة، لتظهر كلفة الوجبة وهامشها في تقرير «كلفة الوجبات». لا تُنقص من المخزون."
    >
      {rows.length === 0 ? <p className="text-ink-muted">لا وصفة لهذه الوجبة بعد.</p> : null}
      <ul aria-label="مكوّنات الوصفة" className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.variantId} className="flex flex-wrap items-end gap-3">
            <span className="min-w-40 flex-1 font-semibold">{row.name}</span>
            <TextField
              label={`كمية ${row.name}${row.unitSymbol ? ` (${row.unitSymbol})` : ''}`}
              inputMode="decimal"
              dir="ltr"
              className="w-32"
              value={row.qty}
              disabled={disabled}
              onChange={(e) =>
                setRows((now) =>
                  now.map((r) =>
                    r.variantId === row.variantId ? { ...r, qty: e.target.value.slice(0, 12) } : r,
                  ),
                )
              }
            />
            <span className="w-28 text-sm text-ink-muted">
              {row.costMinor === null ? (
                'كلفته غير معروفة'
              ) : (
                <Money minor={row.costMinor} currency={me.settings.baseCurrency} />
              )}
            </span>
            <Button
              variant="ghost"
              size="md"
              disabled={disabled}
              onClick={() => setRows((now) => now.filter((r) => r.variantId !== row.variantId))}
            >
              احذف {row.name}
            </Button>
          </li>
        ))}
      </ul>
      {!disabled ? (
        <div className="flex flex-col gap-2">
          <SearchField
            label="ابحث عن مكوّن"
            placeholder="ابحث عن مكوّن"
            value={search}
            onValueChange={setSearch}
          />
          {found.length > 0 ? (
            <ul aria-label="نتائج البحث" className="flex flex-wrap gap-2">
              {found.map((p) => (
                <li key={p.id}>
                  <Button variant="secondary" size="md" onClick={() => void add(p.id)}>
                    أضف {p.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {recipe && recipe.items.length > 0 ? (
        <p className="font-semibold">
          كلفة الحصة <Money minor={recipe.costMinor} currency={me.settings.baseCurrency} />
          {recipe.incomplete ? (
            <span className="text-warning-ink"> (ناقصة: مكوّن بلا كلفة معروفة)</span>
          ) : null}
        </p>
      ) : null}
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!disabled ? (
        <div>
          <Button variant="secondary" disabled={busy} onClick={() => void save()}>
            احفظ الوصفة
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
