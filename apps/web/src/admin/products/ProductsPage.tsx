import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type {
  Category,
  OptionValuesResponse,
  ProductListItem,
  ProductListQuery,
  ProductListTotals,
} from '@serva/core';
import { COUNT_NOUNS, countNoun, getCurrency } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  CameraIcon,
  Checkbox,
  CloseIcon,
  DataTable,
  EditIcon,
  EmptyState,
  IconButton,
  IconChip,
  InfoIcon,
  KpiStrip,
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
  StockIcon,
  WarningIcon,
  cn,
  formatQuantity,
  textLinkClass,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { listCategories, listProducts, lookupBarcode, updateProduct } from '../catalog/api';
import { LiraCaption } from '../../lib/LiraCaption';
import {
  barcodeOf,
  canManageCatalog,
  categoryOptionLabel,
  categoryTree,
  looksLikeBarcode,
  searchTerm,
} from '../catalog/catalog';
import { useBarcodeScanner } from '../catalog/useBarcodeScanner';
import { downloadCsv } from '../exportCsv';
import { useIsPhone } from '../../lib/useIsPhone';
import { placeholderIconFor } from '../../lib/productPlaceholder';
import { BulkPhotos } from './BulkPhotos';
import { shortKinds, shortPieces, StockDefinitions } from '../stockWords';
import { CategorizeDialog, type CategorizeItem } from './CategorizeDialog';
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
  /** «الموسم/التشكيلة»; "" = all */
  season: string;
  status: ListStatus;
  /** «ينتهي قريباً» (30 days) or «منتهية»; "" = all */
  expiry: '' | 'soon' | 'expired';
}

const NO_FILTERS: Filters = { q: '', categoryId: '', season: '', status: 'active', expiry: '' };

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** What the rows on screen add up to, for the tiles over the list. */
type ListSummary = ProductListTotals;

/**
 * The tiles count the whole store (the server's `totals`), whatever the search shows. Only an older
 * server, which sends no totals, falls back to adding up the rows on screen.
 */
function summaryOf(items: readonly ProductListItem[]): ListSummary {
  const stocked = items.filter((item) => item.type === 'stock');
  let lowest: ProductListItem | null = null;
  for (const item of stocked) if (!lowest || item.stockQty < lowest.stockQty) lowest = item;
  return {
    products: items.length,
    variants: stocked.reduce((sum, item) => sum + item.variantCount, 0),
    pieces: stocked.reduce((sum, item) => sum + Math.max(0, item.stockQty), 0),
    negative: stocked.filter((item) => item.stockQty < 0).length,
    runOut: stocked.filter((item) => item.stockQty <= 0).length,
    lowest: lowest ? { nameAr: lowest.nameAr, qty: lowest.stockQty } : null,
  };
}

function PriceCell({ item }: { item: ProductListItem }) {
  if (!item.price) return <span className="text-ink-muted">بعدة عملات</span>;
  const { currency, minMinor, maxMinor } = item.price;
  // A service has no shelf price: the fee is typed at the till
  if (item.type === 'service' && minMinor === 0 && maxMinor === 0) {
    return <Badge tone="info">خدمة · السعر عند البيع</Badge>;
  }
  const amount =
    minMinor === maxMinor ? (
      <Money minor={minMinor} currency={currency} />
    ) : (
      <span>
        <Money minor={minMinor} currency={currency} /> – <Money minor={maxMinor} currency={currency} />
      </span>
    );
  // A dollar price carries its pound equivalent at today's rate
  if (currency !== 'USD') return amount;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {amount}
      <LiraCaption minor={minMinor} currency={currency} />
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

  if (!price || !variantId || (item.type === 'service' && price.minMinor === 0 && price.maxMinor === 0)) {
    return <PriceCell item={item} />;
  }

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

/**
 * The product's first picture, small. One with none shows the icon of its kind (its category, else
 * the store's business type), never a letter; to a manager that icon is the single «أضف صورة»
 * action, and a camera shows over it when the pointer is on it.
 */
function Thumb({
  item,
  canAdd,
  sectors,
}: {
  item: ProductListItem;
  canAdd: boolean;
  sectors: readonly string[];
}) {
  const [broken, setBroken] = useState(false);
  if (item.thumbUrl && !broken) {
    return (
      <img
        src={item.thumbUrl}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="size-11 shrink-0 rounded-control border border-line bg-surface-muted object-cover max-sm:size-10"
      />
    );
  }
  const Kind = placeholderIconFor({
    categoryName: item.categoryName,
    name: item.nameAr,
    sectors,
    isService: item.type === 'service',
  });
  if (canAdd && item.hasImage === false) {
    return (
      <Link
        to={`/products/${item.id}#images`}
        aria-label={`أضف صورة لـ«${item.nameAr}»`}
        title="أضف صورة"
        className="group relative grid size-11 shrink-0 place-items-center rounded-control border border-line bg-surface-muted text-ink-subtle transition-colors duration-120 ease-standard hover:border-brand hover:bg-brand-soft hover:text-brand-ink focus-visible:border-brand max-sm:size-10"
      >
        <Kind size={20} aria-hidden="true" className="group-hover:hidden group-focus-visible:hidden" />
        <CameraIcon
          size={20}
          aria-hidden="true"
          className="hidden group-hover:block group-focus-visible:block"
        />
      </Link>
    );
  }
  return (
    <IconChip tone="neutral" className="size-11 max-sm:size-10">
      <Kind size={20} aria-hidden="true" />
    </IconChip>
  );
}

/** «ينتهي قريباً» in amber, «منتهية» in red, under the date of the nearest expiry */
function ExpiryCell({
  item,
  today,
  digits,
}: {
  item: ProductListItem;
  today: string;
  digits: 'latn' | 'arab';
}) {
  const date = item.nearestExpiry;
  if (!date) return <span className="text-ink-subtle">—</span>;
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  const tone = days < 0 ? 'text-danger-ink' : days <= 30 ? 'text-warning-ink' : 'text-ink-muted';
  return (
    <span className="flex flex-col gap-0.5 whitespace-nowrap">
      <span className={cn('text-sm font-semibold', tone)}>{dayText(date, digits)}</span>
      {days < 0 ? (
        <span className="text-xs text-danger-ink">منتهية</span>
      ) : days <= 30 ? (
        <span className="text-xs text-warning-ink">ينتهي قريباً</span>
      ) : null}
    </span>
  );
}

/** The state of a row, as a word in its colour: archived, waiting for review, or on sale. */
function StatusCell({ item }: { item: ProductListItem }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {item.archivedAt ? <Badge>مؤرشف</Badge> : null}
      {item.status === 'temporary' ? <Badge tone="warning">بانتظار المراجعة</Badge> : null}
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
  const phone = useIsPhone();
  const [exporting, setExporting] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [params] = useSearchParams();
  // «التصنيفات» links here with ?category=
  const [filters, setFilters] = useState<Filters>(() => ({
    ...NO_FILTERS,
    categoryId: params.get('category') ?? '',
  }));
  const q = useDebounced(filters.q, SEARCH_DEBOUNCE_MS);
  const [items, setItems] = useState<ProductListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Counts over the whole store, from the server (the first page carries them)
  const [attention, setAttention] = useState<{
    zeroPrice: number;
    noPhoto: number;
    expiringSoon?: number;
    uncategorised?: number;
  } | null>(null);
  // The whole store's stock numbers for the tiles: they stay while a search narrows the list
  const [totals, setTotals] = useState<ProductListTotals | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  // The seasons the store's products carry (a clothing store's filter)
  const [seasons, setSeasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const request = useRef(0);

  const queryKey = JSON.stringify({
    q: searchTerm(q) || undefined,
    categoryId: filters.categoryId || undefined,
    season: filters.season || undefined,
    status: filters.status,
    expiry: filters.expiry || undefined,
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
      if (page.attention) setAttention(page.attention);
      if (page.totals) setTotals(page.totals);
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
    if (me.tenant.sectors.includes('clothing')) {
      apiFetch<OptionValuesResponse>('/v1/products/options', { auth: true })
        .then((answer) => setSeasons(answer.seasons ?? []))
        .catch(() => setSeasons([]));
    }
  }, [me.tenant.sectors]);

  /** «صدّر الجدول»: every page of the current search, not only what is on screen. */
  async function exportAll() {
    setExporting(true);
    try {
      const all: ProductListItem[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof listProducts>> = await listProducts({
          ...(JSON.parse(queryKey) as ProductListQuery),
          ...(cursor ? { cursor } : {}),
          limit: 200,
        });
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && all.length < 50_000);
      downloadCsv(
        'products',
        ['المنتج', 'الباركود', 'التصنيف', 'المتغيّرات', 'العملة', 'أدنى سعر', 'أعلى سعر', 'الكمية'],
        all.map((i) => [
          i.nameAr,
          i.barcode ?? '',
          i.categoryName ?? '',
          i.variantCount,
          i.price?.currency ?? '',
          i.price ? i.price.minMinor / 10 ** getCurrency(i.price.currency).decimals : '',
          i.price ? i.price.maxMinor / 10 ** getCurrency(i.price.currency).decimals : '',
          i.type === 'service' ? '' : i.stockQty / 1000,
        ]),
      );
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  }

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

  const filtered =
    filters.q.trim() !== '' ||
    filters.categoryId !== '' ||
    filters.season !== '' ||
    filters.status !== 'active' ||
    filters.expiry !== '';
  const tree = categoryTree(categories.filter((c) => !c.archivedAt || c.id === filters.categoryId));
  // What the shown list needs done: a price of 0 sells for nothing, and a missing picture shows as a letter
  const zeroPrice =
    attention?.zeroPrice ??
    (items ?? []).filter((i) => i.type !== 'service' && i.price !== null && i.price.minMinor === 0).length;
  const noPhoto = attention?.noPhoto ?? (items ?? []).filter((i) => i.hasImage === false).length;
  // Products without a category: one press proposes a category for each from its name, then a review
  const uncategorised =
    attention?.uncategorised ?? (items ?? []).filter((i) => !i.categoryId && i.type !== 'service').length;
  const [categorizing, setCategorizing] = useState<CategorizeItem[] | null>(null);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showWhy, setShowWhy] = useState(false);
  // «أخفِ هذا التنبيه»: hidden until the counts grow past what was dismissed (kept on this device)
  const [dismissed, setDismissed] = useState<{ u: number; p: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('serva.products.attention') ?? 'null') as {
        u?: number;
        p?: number;
      } | null;
      return { u: saved?.u ?? -1, p: saved?.p ?? -1 };
    } catch {
      return { u: -1, p: -1 };
    }
  });
  const dismissAttention = (value: { u: number; p: number }) => {
    setDismissed(value);
    try {
      localStorage.setItem('serva.products.attention', JSON.stringify(value));
    } catch {
      // The dismissal then lasts until the page is left
    }
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const asItem = (i: ProductListItem): CategorizeItem => ({
    id: i.id,
    nameAr: i.nameAr,
    version: i.version,
    categoryId: i.categoryId,
  });
  /** «صنّف المحددة»: the rows ticked in the list */
  function categorizeSelected() {
    setCategorizing((items ?? []).filter((i) => selected.has(i.id)).map(asItem));
  }
  /** «صنّف تلقائياً»: every active product without a category, not only the page on screen */
  async function categorizeAuto() {
    setLoadingAuto(true);
    try {
      const found: CategorizeItem[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof listProducts>> = await listProducts({
          status: 'active',
          ...(cursor ? { cursor } : {}),
          limit: 200,
        });
        found.push(...page.items.filter((i) => !i.categoryId && i.type !== 'service').map(asItem));
        cursor = page.nextCursor;
      } while (cursor && found.length < 400);
      if (found.length === 0) setNotice({ tone: 'info', text: 'كل منتجاتك لها تصنيف.' });
      else setCategorizing(found);
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    } finally {
      setLoadingAuto(false);
    }
  }
  const summary = totals ?? (items ? summaryOf(items) : null);
  // More pages wait behind «اعرض المزيد»: the tiles count what is on screen, «+» says there is more.
  const more = !totals && nextCursor ? '+' : '';
  const showSummary = !loadError && (items === null || items.length > 0);

  const today = isoDay(Date.now(), me.tenant.timezone);
  // Expiry shows once any product carries a date: a clothing store never sees it
  const showExpiry =
    filters.expiry !== '' || (attention?.expiringSoon ?? 0) > 0 || (items ?? []).some((i) => i.nearestExpiry);
  const expiringSoon = attention?.expiringSoon ?? 0;

  const rowMenu = (item: ProductListItem) => (
    <Menu
      label={`إجراءات «${item.nameAr}»`}
      align="end"
      trigger={<IconButton size="sm" label={`إجراءات «${item.nameAr}»`} icon={<MoreIcon />} />}
    >
      <MenuItem icon={<EditIcon />} render={(props) => <Link to={`/products/${item.id}`} {...props} />}>
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
  );
  const pickBox = (item: ProductListItem) => (
    <Checkbox
      label={<span className="sr-only">{`حدّد «${item.nameAr}»`}</span>}
      checked={selected.has(item.id)}
      onChange={() => toggle(item.id)}
    />
  );
  const allShownPicked = (items ?? []).length > 0 && (items ?? []).every((i) => selected.has(i.id));
  // «نشط» is the normal state and says nothing: the column shows only when some row is archived or waiting
  const showStatus = (items ?? []).some((i) => i.archivedAt || i.status === 'temporary');

  const columns: DataColumn<ProductListItem>[] = [
    ...(canManage && !phone
      ? [
          {
            key: 'select',
            header: (
              <Checkbox
                label={<span className="sr-only">حدّد كل المنتجات المعروضة</span>}
                checked={allShownPicked}
                onChange={() =>
                  setSelected(allShownPicked ? new Set() : new Set((items ?? []).map((i) => i.id)))
                }
              />
            ),
            className: 'w-10',
            cell: (item: ProductListItem) => pickBox(item),
          } satisfies DataColumn<ProductListItem>,
        ]
      : []),
    {
      key: 'name',
      header: 'المنتج',
      cell: (item) => (
        <div className="flex min-w-0 items-center gap-3 py-2.5 sm:min-w-60">
          <Thumb item={item} canAdd={canManage && !item.archivedAt} sectors={me.tenant.sectors} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1">
              <Link
                to={`/products/${item.id}`}
                className="rounded-small font-semibold text-ink transition-colors duration-120 ease-standard hover:text-brand-ink"
              >
                {item.nameAr}
              </Link>
              {canManage && !phone ? rowMenu(item) : null}
            </span>
            {item.variantCount > 1 || item.barcode ? (
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-subtle">
                {item.variantCount > 1 ? (
                  <span>{countNoun(item.variantCount, COUNT_NOUNS.variant)}</span>
                ) : null}
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
          <span className="flex flex-col items-end">
            <span className="inline-flex items-center gap-1.5">
              {item.stockQty < 0 ? <Badge tone="danger">سالب</Badge> : null}
              <span
                className={cn(
                  'font-semibold',
                  item.stockQty < 0 && 'text-danger-ink',
                  item.stockQty === 0 && 'text-warning-ink',
                )}
              >
                {formatQuantity(item.stockQty, digits)}
              </span>
            </span>
            {item.sellableQty !== undefined && item.sellableQty !== item.stockQty ? (
              <span className="text-xs whitespace-nowrap text-ink-muted">
                متاح للبيع <bdi className="num">{formatQuantity(item.sellableQty, digits)}</bdi>
                {item.sellableQty > item.stockQty ? (
                  <>
                    {' '}
                    ·{' '}
                    <bdi className="text-danger-ink">
                      {shortPieces(
                        (item.sellableQty - item.stockQty) / 1000,
                        formatQuantity(item.sellableQty - item.stockQty, digits),
                      )}
                    </bdi>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        ),
    },
    ...(showExpiry
      ? [
          {
            key: 'expiry',
            header: 'ينتهي',
            className: 'max-md:hidden',
            cell: (item: ProductListItem) => <ExpiryCell item={item} today={today} digits={digits} />,
          } satisfies DataColumn<ProductListItem>,
        ]
      : []),
    ...(showStatus
      ? [
          {
            key: 'status',
            header: 'الحالة',
            cell: (item: ProductListItem) => <StatusCell item={item} />,
          } satisfies DataColumn<ProductListItem>,
        ]
      : []),
  ];

  // A phone gets one primary «+ منتج» and the rest behind «⋯»: the first product stays near the top
  const addProduct = phone ? (
    <div className="flex items-center gap-2">
      <ButtonLink to="/products/new" variant="primary" icon={<AddIcon />} aria-label="أضف منتجاً">
        منتج
      </ButtonLink>
      <Menu
        label="المزيد من الإجراءات"
        align="end"
        trigger={<IconButton label="المزيد من الإجراءات" icon={<MoreIcon />} />}
      >
        <MenuItem onSelect={() => void exportAll()}>صدّر الجدول</MenuItem>
        <MenuItem icon={<CameraIcon />} onSelect={() => setPhotosOpen(true)}>
          أضف صوراً دفعة واحدة
        </MenuItem>
        <MenuItem
          icon={<PackageOpenIcon />}
          render={(props) => <Link to="/import?type=products" {...props} />}
        >
          استيراد من ملف
        </MenuItem>
      </Menu>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" loading={exporting} onClick={() => void exportAll()}>
        صدّر الجدول
      </Button>
      <Button variant="secondary" icon={<CameraIcon />} onClick={() => setPhotosOpen(true)}>
        {noPhoto > 0 && items && filters.status === 'active' ? (
          <>
            أضف صوراً دفعة واحدة · <bdi className="num">{noPhoto}</bdi> بلا صورة
          </>
        ) : (
          'أضف صوراً دفعة واحدة'
        )}
      </Button>
      <ButtonLink to="/import?type=products" icon={<PackageOpenIcon />}>
        استيراد من ملف
      </ButtonLink>
      <ButtonLink to="/products/new" variant="primary" icon={<AddIcon />}>
        أضف منتجاً
      </ButtonLink>
    </div>
  );

  return (
    <>
      <title>المنتجات · SERFA</title>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={<ProductsIcon />}
          title="المنتجات"
          description="ابحث بالاسم، أو امسح باركوداً في أي وقت لتفتح منتجه."
          actions={canManage ? addProduct : null}
        />

        {showSummary ? (
          <KpiStrip columns={showExpiry ? 4 : 3}>
            <StatTile
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
                summary && summary.variants > 0 && summary.variants !== summary.products ? (
                  <>
                    عدد الأصناف: <bdi className="num font-semibold text-ink">{summary.variants}</bdi>
                  </>
                ) : undefined
              }
            />
            <StatTile
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
              footnote={
                summary && summary.negative > 0 ? (
                  <>
                    <bdi className="font-semibold text-ink">{shortKinds(summary.negative)}</bdi>
                  </>
                ) : undefined
              }
            />
            <StatTile
              label="نفد من الرف"
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
                  summary.lowest.qty < 0 ? (
                    <>
                      <Badge tone="danger">سالب</Badge> {summary.lowest.nameAr}: بعتَ أكثر مما سجّلت، صحّح
                      الجرد.
                      {canManage ? (
                        <span className="mt-1 flex">
                          <Link to="/inventory" className={textLinkClass}>
                            اجرد المخزون
                          </Link>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      أقلّها مخزوناً: {summary.lowest.nameAr} —{' '}
                      <bdi className="num font-semibold text-ink">
                        {formatQuantity(summary.lowest.qty, digits)}
                      </bdi>
                    </>
                  )
                ) : undefined
              }
            />
            {showExpiry ? (
              <StatTile
                label="ينتهي خلال 30 يوماً"
                icon={<WarningIcon />}
                iconTone={expiringSoon > 0 ? 'warning' : 'neutral'}
                value={<bdi className="num">{expiringSoon}</bdi>}
                footnote={
                  expiringSoon > 0 && filters.expiry !== 'soon' ? (
                    <button
                      type="button"
                      className={textLinkClass}
                      onClick={() => setFilter('expiry', 'soon')}
                    >
                      اعرضها
                    </button>
                  ) : undefined
                }
              />
            ) : null}
          </KpiStrip>
        ) : null}
        {showSummary && !phone ? <StockDefinitions /> : null}

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
            {seasons.length > 0 || filters.season ? (
              <Select
                label="الموسم"
                hideLabel
                value={filters.season}
                onChange={(event) => setFilter('season', event.target.value)}
                className="min-w-40 flex-1 lg:w-48 lg:flex-none"
              >
                <option value="">كل المواسم</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            ) : null}
            {showExpiry ? (
              <Select
                label="الصلاحية"
                hideLabel
                value={filters.expiry}
                onChange={(event) => setFilter('expiry', event.target.value as Filters['expiry'])}
                className="min-w-40 flex-1 lg:w-48 lg:flex-none"
              >
                <option value="">كل الصلاحيات</option>
                <option value="soon">ينتهي قريباً</option>
                <option value="expired">منتهية</option>
              </Select>
            ) : null}
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

          {/* One attention line: no category, price zero, no picture; the explanations are behind the «i» */}
          {items &&
          filters.status === 'active' &&
          !notice &&
          !(zeroPrice === 0 && uncategorised <= dismissed.u && noPhoto <= dismissed.p) &&
          ((canManage && uncategorised > 0) || zeroPrice > 0 || noPhoto > 0) ? (
            <Alert tone={zeroPrice > 0 ? 'warning' : 'info'}>
              <span className="flex flex-col gap-1.5" aria-label="تحتاج انتباهك">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    {[
                      canManage && uncategorised > 0 ? `${String(uncategorised)} بلا تصنيف` : null,
                      zeroPrice > 0 ? `${String(zeroPrice)} بسعر صفر` : null,
                      noPhoto > 0 ? `${String(noPhoto)} بلا صورة` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {canManage && uncategorised > 0 ? (
                    <button
                      type="button"
                      className={textLinkClass}
                      disabled={loadingAuto}
                      onClick={() => void categorizeAuto()}
                    >
                      صنّفها تلقائياً
                    </button>
                  ) : null}
                  <span className="ms-auto flex items-center gap-1">
                    <IconButton
                      size="xs"
                      label={showWhy ? 'أخفِ الشرح' : 'اشرح'}
                      icon={<InfoIcon size={16} />}
                      onClick={() => setShowWhy((v) => !v)}
                    />
                    {zeroPrice === 0 ? (
                      <IconButton
                        size="xs"
                        label="أخفِ هذا التنبيه"
                        icon={<CloseIcon size={16} />}
                        onClick={() => dismissAttention({ u: uncategorised, p: noPhoto })}
                      />
                    ) : null}
                  </span>
                </span>
                {showWhy ? (
                  <span className="flex flex-col gap-1 text-sm">
                    {canManage && uncategorised > 0 ? (
                      <span>التصنيفات تُسهّل البحث والتقارير، وتُرتّب المتجر الإلكتروني.</span>
                    ) : null}
                    {zeroPrice > 0 ? (
                      <span>بسعر صفر: تُباع مجاناً ولا تظهر في المتجر الإلكتروني.</span>
                    ) : null}
                    {noPhoto > 0 ? <span>الصورة تُظهرها على شاشة البيع وفي المتجر.</span> : null}
                  </span>
                ) : null}
              </span>
            </Alert>
          ) : null}

          {phone && items && items.length > 0 ? (
            <ul
              aria-label="المنتجات"
              className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-e1"
            >
              {items.map((item) => {
                const cell = (key: string) => columns.find((c) => c.key === key)?.cell?.(item);
                return (
                  <li key={item.id} className="flex items-center gap-2 ps-3 pe-1">
                    {canManage ? pickBox(item) : null}
                    <div className="min-w-0 flex-1">{cell('name')}</div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm">
                      <span className="font-semibold whitespace-nowrap">{cell('price')}</span>
                      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                        {cell('stock')}
                        {item.categoryName ? (
                          <span className="max-w-28 truncate">· {item.categoryName}</span>
                        ) : null}
                        {item.archivedAt || item.status === 'temporary' ? cell('status') : null}
                      </span>
                    </div>
                    {canManage ? rowMenu(item) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
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
          )}

          {canManage && selected.size > 0 ? (
            <div
              role="group"
              aria-label="المحددة"
              className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-card border border-brand bg-brand-soft px-4 py-2.5 shadow-e2"
            >
              <span className="font-semibold text-brand-ink">
                <bdi className="num">{selected.size}</bdi> محددة
              </span>
              <Button variant="primary" onClick={categorizeSelected}>
                صنّف المحددة
              </Button>
              <Button variant="secondary" onClick={() => setSelected(new Set())}>
                ألغِ التحديد
              </Button>
            </div>
          ) : null}

          {nextCursor && items ? (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                اعرض المزيد
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {canManage ? (
        <BulkPhotos open={photosOpen} onClose={() => setPhotosOpen(false)} onDone={() => void load()} />
      ) : null}
      {canManage ? (
        <CategorizeDialog
          open={categorizing !== null}
          onClose={() => setCategorizing(null)}
          products={categorizing ?? []}
          categories={categories}
          sectors={me.tenant.sectors}
          onDone={(changed, created) => {
            setSelected(new Set());
            setNotice({
              tone: 'success',
              text:
                created > 0
                  ? `صنّفنا ${countNoun(changed, COUNT_NOUNS.product)} وأضفنا ${countNoun(created, COUNT_NOUNS.category)} جديدة.`
                  : `صنّفنا ${countNoun(changed, COUNT_NOUNS.product)}.`,
            });
            listCategories()
              .then((answer) => setCategories(answer.items))
              .catch(() => undefined);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
