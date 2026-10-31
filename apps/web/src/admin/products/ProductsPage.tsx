import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Category, ProductListItem, ProductListQuery } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  BarcodeIcon,
  Button,
  DataTable,
  EditIcon,
  EmptyState,
  IconButton,
  Money,
  MoneyField,
  ProductsIcon,
  SearchField,
  SegmentedControl,
  Select,
  cn,
  formatQuantity,
  textLinkClass,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { listCategories, listProducts, lookupBarcode, updateProduct } from '../catalog/api';
import {
  barcodeOf,
  canManageCatalog,
  categoryOptionLabel,
  categoryTree,
  looksLikeBarcode,
  searchTerm,
} from '../catalog/catalog';
import { useBarcodeScanner } from '../catalog/useBarcodeScanner';

/** Typing pauses this long before the list is asked again. */
export const SEARCH_DEBOUNCE_MS = 250;
/** One page of the list (17 › القوائم: up to 200). */
export const PRODUCTS_PAGE_SIZE = 50;

type ListStatus = 'active' | 'temporary' | 'archived';

const STATUS_OPTIONS: { value: ListStatus; label: string }[] = [
  { value: 'active', label: 'النشطة' },
  { value: 'temporary', label: 'من الكاشير' },
  { value: 'archived', label: 'المؤرشفة' },
];

interface Filters {
  q: string;
  categoryId: string;
  status: ListStatus;
}

const NO_FILTERS: Filters = { q: '', categoryId: '', status: 'active' };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function PriceCell({ item }: { item: ProductListItem }) {
  if (!item.price) return <span className="text-ink-muted">بعدة عملات</span>;
  const { currency, minMinor, maxMinor } = item.price;
  if (minMinor === maxMinor) return <Money minor={minMinor} currency={currency} />;
  return (
    <span>
      <Money minor={minMinor} currency={currency} /> – <Money minor={maxMinor} currency={currency} />
    </span>
  );
}

interface PriceEditorProps {
  item: ProductListItem;
  onSaved: (item: ProductListItem, message: string) => void;
  onConflict: (message: string) => void;
}

/**
 * «تعديل السعر في مكانه» (12, kit admin/Products): one variant's shelf price, saved with the version
 * the list read (17 › التعديل المتزامن).
 */
function PriceEditor({ item, onSaved, onConflict }: PriceEditorProps) {
  const [editing, setEditing] = useState(false);
  const [priceMinor, setPriceMinor] = useState<number | null>(item.price?.minMinor ?? null);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const price = item.price;
  const variantId = item.singleVariantId;

  if (!price || !variantId) return <PriceCell item={item} />;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <PriceCell item={item} />
        <IconButton
          size="xs"
          label={`عدّل سعر «${item.nameAr}»`}
          icon={<EditIcon size={16} />}
          onClick={() => {
            setPriceMinor(price.minMinor);
            setError(undefined);
            setEditing(true);
          }}
        />
      </span>
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!price || !variantId) return;
    if (priceMinor === null) {
      setError('اكتب السعر');
      return;
    }
    setSaving(true);
    try {
      const detail = await updateProduct(item.id, {
        version: item.version,
        variants: [{ id: variantId, price: { currency: price.currency, priceMinor } }],
      });
      setEditing(false);
      onSaved(
        { ...item, version: detail.version, price: { ...price, minMinor: priceMinor, maxMinor: priceMinor } },
        `حُفظ سعر «${item.nameAr}»، ويصل إلى أجهزة الكاشير مع أول اتصال.`,
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'stale_version') {
        setEditing(false);
        onConflict(`غيّر أحدٌ «${item.nameAr}» للتو. حدّثنا القائمة، جرّب مرة أخرى.`);
      } else {
        setError(
          caught instanceof ApiError && caught.fields
            ? Object.values(caught.fields)[0]
            : errorMessage(caught),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={save} className="flex flex-wrap items-start justify-end gap-2 py-1">
      <MoneyField
        label={`السعر الجديد لـ«${item.nameAr}»`}
        hideLabel
        currency={price.currency}
        valueMinor={priceMinor}
        onValueChange={setPriceMinor}
        error={error}
        className="w-36"
      />
      <Button type="submit" size="sm" loading={saving}>
        احفظ
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        تراجع
      </Button>
    </form>
  );
}

/**
 * «المنتجات» (12 › المنتجات وبطاقة المنتج; kit admin/Products): search by name (normalized Arabic)
 * or barcode, a scanner that works without clicking anywhere, category and status filters, pages,
 * and the in-place price edit.
 */
export function ProductsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const canManage = canManageCatalog(me);
  const [params] = useSearchParams();
  // «التصنيفات» links here with ?category=
  const [filters, setFilters] = useState<Filters>(() => ({
    ...NO_FILTERS,
    categoryId: params.get('category') ?? '',
  }));
  const q = useDebounced(filters.q, SEARCH_DEBOUNCE_MS);
  const [items, setItems] = useState<ProductListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const request = useRef(0);

  const queryKey = JSON.stringify({
    q: searchTerm(q) || undefined,
    categoryId: filters.categoryId || undefined,
    status: filters.status,
  } satisfies ProductListQuery);

  const load = useCallback(async () => {
    const id = ++request.current;
    setItems(null);
    setLoadError(null);
    try {
      const page = await listProducts({
        ...(JSON.parse(queryKey) as ProductListQuery),
        limit: PRODUCTS_PAGE_SIZE,
      });
      if (id !== request.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (id === request.current) setLoadError(errorMessage(error));
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listCategories()
      .then((answer) => setCategories(answer.items))
      // The filter is a convenience: the list works without it.
      .catch(() => setCategories([]));
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    const id = request.current;
    setLoadingMore(true);
    try {
      const page = await listProducts({
        ...(JSON.parse(queryKey) as ProductListQuery),
        cursor: nextCursor,
        limit: PRODUCTS_PAGE_SIZE,
      });
      if (id !== request.current) return;
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function openBarcode(raw: string) {
    const code = barcodeOf(raw);
    setUnknownCode(null);
    setNotice(null);
    try {
      const found = await lookupBarcode(code);
      void navigate(`/products/${found.productId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found') setUnknownCode(code);
      else setNotice({ tone: 'error', text: errorMessage(error) });
    }
  }

  useBarcodeScanner((code) => void openBarcode(code));

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setUnknownCode(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const filtered = filters.q.trim() !== '' || filters.categoryId !== '' || filters.status !== 'active';
  const tree = categoryTree(categories.filter((c) => !c.archivedAt || c.id === filters.categoryId));

  const columns: DataColumn<ProductListItem>[] = [
    {
      key: 'name',
      header: 'المنتج',
      cell: (item) => (
        <div className="flex min-w-48 flex-col gap-0.5 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <Link to={`/products/${item.id}`} className="font-semibold text-ink hover:text-brand-ink">
              {item.nameAr}
            </Link>
            {item.status === 'temporary' ? <Badge tone="warning">بانتظار المراجعة</Badge> : null}
            {item.archivedAt ? <Badge>مؤرشف</Badge> : null}
          </span>
          <span className="flex flex-wrap gap-2 text-[0.8125rem] text-ink-muted">
            {item.barcode ? (
              <bdi dir="ltr" className="num">
                {item.barcode}
              </bdi>
            ) : null}
            {item.variantCount > 1 ? <span>{item.variantCount} متغيّرات</span> : null}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'التصنيف',
      cell: (item) => item.categoryName ?? <span className="text-ink-subtle">بلا تصنيف</span>,
    },
    {
      key: 'price',
      header: 'سعر البيع',
      numeric: true,
      cell: (item) =>
        canManage && !item.archivedAt ? (
          <PriceEditor
            key={`${item.id}-${item.version}`}
            item={item}
            onSaved={(updated, text) => {
              setItems((current) => current?.map((row) => (row.id === updated.id ? updated : row)) ?? null);
              setNotice({ tone: 'success', text });
            }}
            onConflict={(text) => {
              setNotice({ tone: 'error', text });
              void load();
            }}
          />
        ) : (
          <PriceCell item={item} />
        ),
    },
    {
      key: 'stock',
      header: 'الكمية',
      numeric: true,
      cell: (item) =>
        item.type === 'service' ? (
          <span className="text-ink-subtle">—</span>
        ) : (
          <span className={cn(item.stockQty < 0 && 'text-danger-ink')}>
            {formatQuantity(item.stockQty, me.settings.numberFormat)}
          </span>
        ),
    },
  ];

  return (
    <AppShell>
      <title>المنتجات · Serva POS</title>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink">المنتجات</h1>
            <p className="text-ink-muted">
              ابحث بالاسم أو امسح الباركود.{' '}
              <Link to="/categories" className={textLinkClass}>
                التصنيفات
              </Link>
            </p>
          </div>
          {canManage ? (
            <Link
              to="/products/new"
              className="inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand hover:bg-brand-hover max-sm:w-full max-sm:justify-center"
            >
              <AddIcon />
              أضف منتجاً
            </Link>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SearchField
            label="ابحث بالاسم أو الباركود"
            value={filters.q}
            onValueChange={(value) => setFilter('q', value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && looksLikeBarcode(filters.q)) {
                event.preventDefault();
                void openBarcode(filters.q);
              }
            }}
            slashShortcut
            className="lg:flex-1"
          />
          <Select
            label="التصنيف"
            hideLabel
            value={filters.categoryId}
            onChange={(event) => setFilter('categoryId', event.target.value)}
            className="lg:w-56"
          >
            <option value="">كل التصنيفات</option>
            {tree.map((node) => (
              <option key={node.category.id} value={node.category.id}>
                {categoryOptionLabel(node)}
              </option>
            ))}
          </Select>
          <SegmentedControl
            label="حالة المنتج"
            options={STATUS_OPTIONS}
            value={filters.status}
            onValueChange={(value) => setFilter('status', value)}
          />
        </div>

        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

        {unknownCode ? (
          <Alert tone="info">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                لا منتج بهذا الباركود:{' '}
                <bdi dir="ltr" className="num">
                  {unknownCode}
                </bdi>
              </span>
              {canManage ? (
                <Link
                  to={`/products/new?barcode=${encodeURIComponent(unknownCode)}`}
                  className={textLinkClass}
                >
                  أضف منتجاً بهذا الباركود
                </Link>
              ) : null}
            </span>
          </Alert>
        ) : null}

        <DataTable
          caption="المنتجات"
          columns={columns}
          rows={items ?? []}
          rowKey={(item) => item.id}
          loading={items === null && !loadError}
          error={loadError ?? undefined}
          onRetry={() => void load()}
          empty={
            filtered ? (
              <EmptyState
                icon={ProductsIcon}
                title="لا منتجات تطابق بحثك."
                description="جرّب كلمة أخرى أو تصنيفاً آخر."
                action={
                  <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                    امسح البحث والتصفية
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ProductsIcon}
                title="لا منتجات بعد."
                description="أضف منتجك الأول باسمه وسعره وباركوده، فيصل إلى أجهزة الكاشير."
                action={
                  canManage ? (
                    <Link
                      to="/products/new"
                      className="inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand hover:bg-brand-hover"
                    >
                      <AddIcon />
                      أضف منتجاً
                    </Link>
                  ) : null
                }
              />
            )
          }
        />

        {nextCursor && items ? (
          <div className="flex justify-center">
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
              اعرض المزيد
            </Button>
          </div>
        ) : null}

        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <BarcodeIcon />
          امسح باركوداً في أي وقت لتفتح منتجه.
        </p>
      </div>
    </AppShell>
  );
}
