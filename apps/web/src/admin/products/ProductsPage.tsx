import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Category, ProductListItem, ProductListQuery } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  EditIcon,
  EmptyState,
  IconButton,
  IconChip,
  Menu,
  MenuItem,
  Money,
  MoneyField,
  MoreIcon,
  PackageOpenIcon,
  PageHeader,
  PrintIcon,
  ProductsIcon,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  StatTile,
  StatusChip,
  StockIcon,
  WarningIcon,
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
import { ButtonLink } from './parts';

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

/** A tile's width in the phone's sideways row; the grid sizes them from 640 px. */
const TILE = 'w-64 shrink-0 snap-start sm:w-auto';

/** What the rows on screen add up to, for the tiles over the list. */
interface ListSummary {
  products: number;
  variants: number;
  /** Thousandths, over the stocked products */
  pieces: number;
  /** Stocked products at zero or below */
  runOut: number;
  /** The stocked product with the least left */
  lowest: ProductListItem | null;
}

function summaryOf(items: readonly ProductListItem[]): ListSummary {
  const stocked = items.filter((item) => item.type === 'stock');
  let lowest: ProductListItem | null = null;
  for (const item of stocked) if (!lowest || item.stockQty < lowest.stockQty) lowest = item;
  return {
    products: items.length,
    variants: items.reduce((sum, item) => sum + item.variantCount, 0),
    pieces: stocked.reduce((sum, item) => sum + item.stockQty, 0),
    runOut: stocked.filter((item) => item.stockQty <= 0).length,
    lowest,
  };
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
    <form noValidate onSubmit={save} className="flex flex-wrap items-start justify-end gap-2 py-2">
      <MoneyField
        label={`السعر الجديد لـ«${item.nameAr}»`}
        hideLabel
        currency={price.currency}
        valueMinor={priceMinor}
        onValueChange={setPriceMinor}
        error={error}
        className="w-36"
      />
      <Button type="submit" loading={saving}>
        احفظ
      </Button>
      <Button variant="ghost" onClick={() => setEditing(false)}>
        تراجع
      </Button>
    </form>
  );
}

/** The state of a row, as a word in its colour: archived, waiting for review, or on sale. */
function StatusCell({ item }: { item: ProductListItem }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {item.archivedAt ? <Badge>مؤرشف</Badge> : null}
      {item.status === 'temporary' ? <Badge tone="warning">بانتظار المراجعة</Badge> : null}
      {!item.archivedAt && item.status !== 'temporary' ? <StatusChip status="active" /> : null}
    </span>
  );
}

/**
 * «المنتجات» (12 › المنتجات وبطاقة المنتج; kit admin/Products): search by name (normalized Arabic)
 * or barcode, a scanner that works without clicking anywhere, category and status filters, pages,
 * and the in-place price edit.
 */
export function ProductsPage() {
  // The list keeps its state below the shell, so typing in the search never redraws the menu and
  // the top bar.
  return (
    <AppShell>
      <ProductsList />
    </AppShell>
  );
}

function ProductsList() {
  const me = useMe();
  const navigate = useNavigate();
  const canManage = canManageCatalog(me);
  const digits = me.settings.numberFormat;
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
  const summary = items ? summaryOf(items) : null;
  // More pages wait behind «اعرض المزيد»: the tiles count what is on screen, «+» says there is more.
  const more = nextCursor ? '+' : '';
  const showSummary = !loadError && (items === null || items.length > 0);

  const columns: DataColumn<ProductListItem>[] = [
    {
      key: 'name',
      header: 'المنتج',
      cell: (item) => (
        <div className="flex min-w-44 items-center gap-3 py-2.5 sm:min-w-60">
          <IconChip className="text-base font-bold max-sm:hidden">
            {Array.from(item.nameAr.trim())[0] ?? ''}
          </IconChip>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              to={`/products/${item.id}`}
              className="rounded-small font-semibold text-ink transition-colors duration-120 ease-standard hover:text-brand-ink"
            >
              {item.nameAr}
            </Link>
            {item.variantCount > 1 || item.barcode ? (
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-subtle">
                {item.variantCount > 1 ? <span>{item.variantCount} متغيّرات</span> : null}
                {item.variantCount > 1 && item.barcode ? <span aria-hidden="true">·</span> : null}
                {item.barcode ? (
                  <bdi dir="ltr" className="num">
                    {item.barcode}
                  </bdi>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'التصنيف',
      // A phone keeps the price and the stock in view; the category is on the product's card.
      className: 'max-md:hidden',
      cell: (item) =>
        item.categoryName ? (
          <span className="whitespace-nowrap text-ink-muted">{item.categoryName}</span>
        ) : (
          <span className="whitespace-nowrap text-ink-subtle">بلا تصنيف</span>
        ),
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
          <span
            className={cn(
              'font-semibold',
              item.stockQty < 0 && 'text-danger-ink',
              item.stockQty === 0 && 'text-warning-ink',
            )}
          >
            {formatQuantity(item.stockQty, digits)}
          </span>
        ),
    },
    { key: 'status', header: 'الحالة', cell: (item) => <StatusCell item={item} /> },
    ...(canManage
      ? [
          {
            key: 'actions',
            // The words are for screen readers; the box around them keeps them inside the table's
            // scroll on a phone (a lone sr-only box escapes it and widens the page).
            header: (
              <span className="relative block">
                <span className="sr-only">إجراءات</span>
              </span>
            ),
            className: 'w-14',
            cell: (item: ProductListItem) => (
              <Menu
                label={`إجراءات «${item.nameAr}»`}
                align="end"
                trigger={<IconButton size="sm" label={`إجراءات «${item.nameAr}»`} icon={<MoreIcon />} />}
              >
                <MenuItem
                  icon={<EditIcon />}
                  render={(props) => <Link to={`/products/${item.id}`} {...props} />}
                >
                  افتح المنتج
                </MenuItem>
                {!item.archivedAt ? (
                  <MenuItem
                    icon={<PrintIcon />}
                    render={(props) => <Link to={`/labels?product=${item.id}`} {...props} />}
                  >
                    اطبع الملصقات
                  </MenuItem>
                ) : null}
              </Menu>
            ),
          } satisfies DataColumn<ProductListItem>,
        ]
      : []),
  ];

  const addProduct = (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink to="/import?type=products" icon={<PackageOpenIcon />}>
        استيراد من Excel
      </ButtonLink>
      <ButtonLink to="/products/new" variant="primary" icon={<AddIcon />}>
        أضف منتجاً
      </ButtonLink>
    </div>
  );

  return (
    <>
      <title>المنتجات · Serva POS</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<ProductsIcon />}
          title="المنتجات"
          description="ابحث بالاسم، أو امسح باركوداً في أي وقت لتفتح منتجه."
          actions={canManage ? addProduct : null}
        />

        {showSummary ? (
          // On a phone the tiles slide sideways in one row instead of filling the screen.
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
            <StatTile
              className={TILE}
              label="المنتجات"
              icon={<ProductsIcon />}
              value={
                summary ? (
                  <bdi className="num">{`${summary.products}${more}`}</bdi>
                ) : (
                  <Skeleton className="my-1.5 h-6 w-16" />
                )
              }
              footnote={
                summary && summary.variants > summary.products ? (
                  <>
                    المتغيّرات: <bdi className="num font-semibold text-ink">{summary.variants}</bdi>
                  </>
                ) : undefined
              }
            />
            <StatTile
              className={TILE}
              label="القطع في المخزون"
              icon={<StockIcon />}
              iconTone="neutral"
              value={
                summary ? (
                  <bdi className="num">{`${formatQuantity(summary.pieces, digits)}${more}`}</bdi>
                ) : (
                  <Skeleton className="my-1.5 h-6 w-20" />
                )
              }
            />
            <StatTile
              className={TILE}
              label="نفد مخزونها"
              icon={<WarningIcon />}
              iconTone={summary && summary.runOut > 0 ? 'warning' : 'neutral'}
              value={
                summary ? (
                  <bdi className="num">{`${summary.runOut}${more}`}</bdi>
                ) : (
                  <Skeleton className="my-1.5 h-6 w-12" />
                )
              }
              footnote={
                summary?.lowest ? (
                  <>
                    أقلّها: {summary.lowest.nameAr} ·{' '}
                    <bdi className="num font-semibold text-ink">
                      {formatQuantity(summary.lowest.stockQty, digits)}
                    </bdi>
                  </>
                ) : undefined
              }
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label="ابحث بالاسم أو الباركود"
              placeholder="ابحث بالاسم أو امسح الباركود"
              value={filters.q}
              onValueChange={(value) => setFilter('q', value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && looksLikeBarcode(filters.q)) {
                  event.preventDefault();
                  void openBarcode(filters.q);
                }
              }}
              slashShortcut
              className="min-w-0 basis-full lg:min-w-64 lg:flex-1 lg:basis-0"
            />
            <Select
              label="التصنيف"
              hideLabel
              value={filters.categoryId}
              onChange={(event) => setFilter('categoryId', event.target.value)}
              className="min-w-40 flex-1 lg:w-56 lg:flex-none"
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
              fullWidth
              className="max-sm:w-full"
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
                  action={canManage ? addProduct : null}
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
        </div>
      </div>
    </>
  );
}
