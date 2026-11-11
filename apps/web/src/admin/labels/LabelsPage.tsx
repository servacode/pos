import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ProductDetail, ProductListItem } from '@serva/core';
import {
  AddIcon,
  Alert,
  BarcodeIcon,
  Button,
  Card,
  CardHeader,
  DeleteIcon,
  EmptyState,
  IconButton,
  Money,
  PageHeader,
  PrintIcon,
  SearchField,
  Select,
  Switch,
  TextField,
  Tooltip,
  cn,
  CONTROL_HEIGHT,
  useDensity,
} from '@serva/ui';
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
  const density = useDensity();
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
  const spec = LABEL_LAYOUTS[layout];

  return (
    <AppShell>
      <title>طباعة الملصقات · Serva POS</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="طباعة الملصقات"
          description="ملصق لكل قطعة: اسمها ومقاسها ولونها وسعرها وباركودها، على لفة طابعة الملصقات أو ورق A4."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <CardHeader
              icon={<BarcodeIcon />}
              title="القطع"
              description="ابحث عن منتج لتضيف كل قطعه، ثم اكتب كم ملصقاً تريد لكل قطعة."
            />
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <SearchField label="أضف منتجاً بكل قطعه" value={q} onValueChange={setQ} />
                {found.length > 0 ? (
                  <ul
                    aria-label="نتائج البحث"
                    className="flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-e2"
                  >
                    {found.map((p) => (
                      <li key={p.id} className="border-b border-line last:border-0">
                        <button
                          type="button"
                          aria-label={`أضف ${p.nameAr} بكل قطعه`}
                          onClick={() => {
                            setQ('');
                            void getProduct(p.id).then((d) => addProduct(d));
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-1.5 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted',
                            CONTROL_HEIGHT[density],
                          )}
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[0.9375rem] font-semibold text-ink">
                              {p.nameAr}
                            </span>
                            {p.categoryName ? (
                              <span className="truncate text-xs text-ink-subtle">{p.categoryName}</span>
                            ) : null}
                          </span>
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-ink">
                            <AddIcon size={16} />
                            كل قطعه
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {noCode.map((p) => (
                <Alert key={p.id} tone="warning">
                  <span className="flex flex-wrap items-center gap-3">
                    بعض قطع «{p.nameAr}» بلا باركود.
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<BarcodeIcon />}
                      onClick={() => void giveCodes(p)}
                    >
                      ولّد لها باركوداً داخلياً
                    </Button>
                  </span>
                </Alert>
              ))}
              {items.length > 0 ? (
                <div className="flex flex-col">
                  <div
                    aria-hidden="true"
                    className="flex items-center gap-3 border-b border-line pb-2 text-xs font-semibold text-ink-subtle"
                  >
                    <span className="flex-1">القطعة</span>
                    <span className="w-28 text-center max-sm:hidden">السعر</span>
                    <span className="w-20 text-center">الملصقات</span>
                    <span className="w-10 pointer-coarse:w-12" />
                  </div>
                  <ul aria-label="الملصقات" className="flex flex-col">
                    {items.map((item, index) => {
                      // A product's pieces follow one another: its name heads the first of them.
                      const first = index === 0 || items[index - 1]?.name !== item.name;
                      const last = index === items.length - 1 || items[index + 1]?.name !== item.name;
                      return (
                        <li
                          key={item.key}
                          className={cn(
                            'flex flex-col',
                            last && 'border-b border-line pb-2 last:border-0 last:pb-0',
                          )}
                        >
                          {first ? (
                            <span className="truncate pt-3 pb-1 font-semibold text-ink">{item.name}</span>
                          ) : null}
                          <span className="flex items-center gap-3 py-1.5">
                            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                              {item.options?.split(' · ').map((option, at) => (
                                <span
                                  key={at}
                                  className="rounded-small border border-line bg-surface-muted px-1.5 text-xs leading-5 font-semibold text-ink-muted"
                                >
                                  {option}
                                </span>
                              ))}
                              <bdi dir="ltr" className="num text-sm text-ink-subtle">
                                {item.code}
                              </bdi>
                            </span>
                            <Money
                              minor={item.priceMinor}
                              currency={item.currency}
                              className="w-28 text-center text-sm text-ink-muted max-sm:hidden"
                            />
                            <TextField
                              label={`عدد ملصقات ${item.name}${item.options ? ` ${item.options}` : ''}`}
                              hideLabel
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
                              inputClassName="num"
                              className="w-20"
                            />
                            <Tooltip content="احذف من القائمة">
                              <IconButton
                                label="احذف"
                                icon={<DeleteIcon />}
                                onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                              />
                            </Tooltip>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <EmptyState
                  icon={BarcodeIcon}
                  title="لا ملصقات بعد."
                  description="ابحث عن منتج لتضيف كل قطعه، أو افتح هذه الصفحة من بطاقة منتج أو من فاتورة شراء."
                />
              )}
            </div>
          </Card>

          <Card className="xl:sticky xl:top-32">
            <CardHeader
              icon={<PrintIcon />}
              title="المعاينة"
              description="بالحجم الحقيقي، كما تخرج من الطابعة."
            />
            <div className="flex flex-col gap-4">
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
              <figure>
                {/* The paper: each piece's label at its real size, with how many copies print. On a
                    wide screen the panel stays in view, so the paper takes the height that is left. */}
                <div className="flex max-h-96 flex-col items-center gap-5 overflow-y-auto rounded-control border border-line bg-surface-muted px-4 py-6 xl:max-h-[max(11rem,calc(100dvh-35rem))]">
                  {items.length > 0 ? (
                    items.map((item) => (
                      <div
                        key={item.key}
                        className={cn('relative shrink-0', item.copies === 0 && 'opacity-40')}
                      >
                        <div
                          className="overflow-hidden rounded-small shadow-e2 ring-1 ring-line"
                          style={{ width: `${spec.width}mm`, height: `${spec.height}mm` }}
                        >
                          <Label item={item} store={me.tenant.name} showStore={showStore} />
                        </div>
                        <bdi
                          dir="ltr"
                          className="num absolute -end-2.5 -top-2.5 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-on-brand"
                        >
                          ×{Math.max(0, item.copies)}
                        </bdi>
                      </div>
                    ))
                  ) : (
                    <div
                      className="grid shrink-0 place-items-center rounded-small border border-dashed border-line-control/50 bg-surface text-xs text-ink-subtle"
                      style={{ width: `${spec.width}mm`, height: `${spec.height}mm` }}
                    >
                      الملصق هنا
                    </div>
                  )}
                </div>
                <figcaption className="sr-only">معاينة بالحجم الحقيقي · {spec.label}</figcaption>
              </figure>
              <Button
                size="lg"
                fullWidth
                icon={<PrintIcon />}
                disabled={total === 0}
                onClick={() => setPrinting(true)}
              >
                اطبع <bdi className="num">{total}</bdi> ملصقاً
              </Button>
            </div>
          </Card>
        </div>
      </div>
      {printing ? (
        <PrintableLabels items={items} layout={layout} store={me.tenant.name} showStore={showStore} />
      ) : null}
    </AppShell>
  );
}
