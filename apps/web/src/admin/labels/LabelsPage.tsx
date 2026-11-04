import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ProductDetail, ProductListItem } from '@serva/core';
import { Alert, Button, SearchField, Select, Switch, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getProduct, listProducts, updateProduct } from '../catalog/api';
import { getPurchase } from '../purchases/api';
import { Label, LABEL_LAYOUTS, PrintableLabels, type LabelItem, type LabelLayout } from './Label';

const LAYOUT_KEY = 'serva.labels.layout';

/** The code printed for a variant: its piece barcode, else its first; null when it has none. */
function codeOf(v: ProductDetail['variants'][number]): string | null {
  return (v.barcodes.find((b) => b.packQty === 1000) ?? v.barcodes[0])?.code ?? null;
}

/** A product's live pieces as labels; `copies` gives each piece's count (1 by default). */
export function itemsOf(
  p: ProductDetail,
  copies: (variantId: string) => number = () => 1,
): {
  items: LabelItem[];
  missing: number;
} {
  const live = p.variants.filter((v) => !v.archivedAt);
  const items: LabelItem[] = [];
  let missing = 0;
  for (const v of live) {
    const code = codeOf(v);
    if (!code) {
      missing += 1;
      continue;
    }
    items.push({
      key: v.id,
      name: p.nameAr,
      options: v.attributes.length ? v.attributes.map((a) => a.value).join(' · ') : null,
      priceMinor: v.price.priceMinor,
      wasMinor: v.wasPriceMinor,
      currency: v.price.currency,
      code,
      copies: copies(v.id),
    });
  }
  return { items, missing };
}

/**
 * «طباعة الملصقات» (03 › الملابس: ملصق لكل قطعة): labels with the product, its size and colour, the
 * price and the barcode, for a label printer's roll or A4 sticker sheets. Opened from a product
 * (every piece once), from a purchase (as many as came in), or filled by searching here.
 */
export function LabelsPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const [items, setItems] = useState<LabelItem[]>([]);
  const [noCode, setNoCode] = useState<ProductDetail[]>([]);
  const [layout, setLayout] = useState<LabelLayout>(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY) as LabelLayout | null;
      return saved && saved in LABEL_LAYOUTS ? saved : '40x30';
    } catch {
      return '40x30';
    }
  });
  const [showStore, setShowStore] = useState(true);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<ProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  function addProduct(p: ProductDetail, copies?: (variantId: string) => number) {
    const { items: more, missing } = itemsOf(p, copies);
    setItems((list) => [...list.filter((i) => !more.some((m) => m.key === i.key)), ...more]);
    setNoCode((list) =>
      missing > 0 ? [...list.filter((x) => x.id !== p.id), p] : list.filter((x) => x.id !== p.id),
    );
  }

  useEffect(() => {
    const product = params.get('product');
    const purchase = params.get('purchase');
    // After a price change (products/BulkPricesPage): every changed product, one label each piece
    const several = (params.get('products') ?? '').split(',').filter(Boolean).slice(0, 200);
    for (const id of several) {
      getProduct(id)
        .then((p) => addProduct(p))
        .catch((e: unknown) => setError(errorMessage(e)));
    }
    if (product) {
      getProduct(product)
        .then((p) => addProduct(p))
        .catch((e: unknown) => setError(errorMessage(e)));
    }
    if (purchase) {
      getPurchase(purchase)
        .then(async (p) => {
          const pieces = new Map(p.lines.map((l) => [l.variantId, Math.max(1, Math.round(l.qty / 1000))]));
          for (const productId of new Set(p.lines.map((l) => l.productId).filter(Boolean))) {
            const detail = await getProduct(productId);
            addProduct(
              { ...detail, variants: detail.variants.filter((v) => pieces.has(v.id)) },
              (id) => pieces.get(id) ?? 1,
            );
          }
        })
        .catch((e: unknown) => setError(errorMessage(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once from the address
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      listProducts({ q: q.trim(), limit: 8 })
        .then((r) => setFound(r.items))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  /** Internal barcodes (prefix 29) for every piece of the product that has none. */
  async function giveCodes(p: ProductDetail) {
    setError(null);
    try {
      const updated = await updateProduct(p.id, {
        version: p.version,
        variants: p.variants
          .filter((v) => !v.archivedAt && !codeOf(v))
          .map((v) => ({
            id: v.id,
            barcodes: [
              ...v.barcodes.map((b) => ({
                id: b.id,
                kind: b.kind,
                code: b.code,
                packQty: b.packQty,
                packName: b.packName,
                packPriceMinor: b.packPriceMinor,
              })),
              { kind: 'internal' as const },
            ],
          })),
      });
      addProduct(updated);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const total = items.reduce((n, i) => n + Math.max(0, i.copies), 0);
  const sample = items[0];

  return (
    <AppShell>
      <title>طباعة الملصقات · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">طباعة الملصقات</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {noCode.map((p) => (
          <Alert key={p.id} tone="info">
            <span className="flex flex-wrap items-center gap-3">
              بعض قطع «{p.nameAr}» بلا باركود.
              <Button size="sm" variant="secondary" onClick={() => void giveCodes(p)}>
                ولّد لها باركوداً داخلياً
              </Button>
            </span>
          </Alert>
        ))}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-3">
            <SearchField label="أضف منتجاً بكل قطعه" value={q} onValueChange={setQ} />
            {found.length > 0 ? (
              <ul aria-label="نتائج البحث" className="flex flex-wrap gap-2">
                {found.map((p) => (
                  <li key={p.id}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setQ('');
                        void getProduct(p.id).then((d) => addProduct(d));
                      }}
                    >
                      + {p.nameAr}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Select
              label="الورق"
              value={layout}
              onChange={(e) => {
                const next = e.target.value as LabelLayout;
                setLayout(next);
                try {
                  localStorage.setItem(LAYOUT_KEY, next);
                } catch {
                  /* a private window: not remembered */
                }
              }}
            >
              {(Object.keys(LABEL_LAYOUTS) as LabelLayout[]).map((k) => (
                <option key={k} value={k}>
                  {LABEL_LAYOUTS[k].label}
                </option>
              ))}
            </Select>
            <Switch label="اسم المحل على الملصق" checked={showStore} onCheckedChange={setShowStore} />
          </div>
          {sample ? (
            <figure className="flex flex-col items-center gap-2">
              <div
                className="border border-line shadow-sm"
                style={{
                  width: `${LABEL_LAYOUTS[layout].width}mm`,
                  height: `${LABEL_LAYOUTS[layout].height}mm`,
                }}
              >
                <Label item={sample} store={me.tenant.name} showStore={showStore} />
              </div>
              <figcaption className="text-sm text-ink-muted">معاينة بالحجم الحقيقي</figcaption>
            </figure>
          ) : null}
        </div>
        {items.length > 0 ? (
          <ul aria-label="الملصقات" className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-end gap-3 rounded-card border border-line bg-surface p-3"
              >
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold text-ink">
                    {item.name}
                    {item.options ? ` · ${item.options}` : ''}
                  </span>
                  <bdi dir="ltr" className="num text-start text-sm text-ink-muted">
                    {item.code}
                  </bdi>
                </span>
                <TextField
                  label={`عدد ملصقات ${item.name}${item.options ? ` ${item.options}` : ''}`}
                  inputMode="numeric"
                  dir="ltr"
                  value={String(item.copies)}
                  onChange={(e) => {
                    const n = Number(
                      e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))),
                    );
                    setItems((list) =>
                      list.map((i) =>
                        i.key === item.key
                          ? { ...i, copies: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 }
                          : i,
                      ),
                    );
                  }}
                  className="w-28"
                />
                <Button
                  variant="ghost"
                  onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                >
                  احذف
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Alert tone="info">
            ابحث عن منتج لتضيف كل قطعه، أو افتح هذه الصفحة من بطاقة منتج أو من فاتورة شراء.
          </Alert>
        )}
        <div className="flex items-center gap-3">
          <Button size="lg" disabled={total === 0} onClick={() => setPrinting(true)}>
            اطبع {total} ملصقاً
          </Button>
        </div>
      </div>
      {printing ? (
        <PrintableLabels items={items} layout={layout} store={me.tenant.name} showStore={showStore} />
      ) : null}
    </AppShell>
  );
}
