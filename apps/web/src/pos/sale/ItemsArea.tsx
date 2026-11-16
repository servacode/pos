import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { batchState } from '@serva/core/pharmacy';
import { convert } from '@serva/core/money';
import { businessDateOf, rateFor } from '@serva/core/sale';
import { toLatinDigits } from '@serva/core/text';
import { dayText } from '../../lib/dates';
import {
  Badge,
  BarcodeIcon,
  Button,
  CloseIcon,
  cn,
  CONTROL_HEIGHT,
  displayNumber,
  EmptyState,
  formatQuantity,
  GridIcon,
  IconButton,
  InfoIcon,
  ItemTile,
  Money,
  ProductsIcon,
  RepeatIcon,
  SearchIcon,
  TextField,
  useDigits,
  WarningIcon,
  type Icon,
} from '@serva/ui';
import { barcodeKey, searchCatalog, type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { Kbd } from './Kbd';
import { gridEntries, lowestPrice, piecesText, sizeStock, type GridEntry } from './models';
import { stockInPacks } from './packStock';
import { placeholderIconFor } from '../../lib/productPlaceholder';
import { expiryText, sellableQty, tileInfo } from './tileInfo';
import { pieceWord } from './packText';
import { clicksSwallowed } from './clickGuard';

const PHOTOS_OFF_KEY = 'tillPhotosOff';
/** The compact tile density, kept on this device */
const COMPACT_KEY = 'tillCompactTiles';

export interface PriceCheck {
  /** The product's name */
  name: string;
  /** Its pieces (sizes, colours), or the one item */
  pieces: readonly CatalogItem[];
  /** The piece that was scanned, if one was */
  focus: string | null;
  /** The pack that was scanned (a box of 12): its name, size and price */
  pack?: { name: string | null; qty: number; priceMinor: number; currency: CurrencyCode } | null;
  /** The boxes each piece is sold in (by variant), with the box's price: shown under the piece's price */
  packs?: Readonly<
    Record<
      string,
      readonly { name: string | null; qty: number; priceMinor: number; currency: CurrencyCode }[]
    >
  >;
}

export interface ItemsAreaProps {
  catalog: Catalog;
  /** Every model's pieces, by product (models.modelPieces) */
  pieces: ReadonlyMap<string, CatalogItem[]>;
  /** The products sold most on this device, best first: a strip above the grid while nothing is searched */
  bestSellers?: readonly string[];
  searchRef: RefObject<HTMLInputElement | null>;
  /** Variants in the cart, for the tiles' selected edge */
  inCart: ReadonlySet<string>;
  /** A model tile that is open in the picker */
  pickingProduct: string | null;
  multiplier: number | null;
  notice: { tone: 'warning' | 'info'; text: string } | null;
  onDismissNotice: () => void;
  hasLastLines: boolean;
  onRepeatLast: () => void;
  /** A tile, or the only result of the search */
  onPickItem: (item: CatalogItem, hit?: BarcodeHit | null) => void;
  /** A model's tile was tapped; `size` is the size chip that was hit, when one was */
  onPickModel: (productId: string, size?: { option: string; value: string }) => void;
  /** A long code typed into the search field, handled as a scan */
  onScanCode: (code: string) => void;
  onMultiplier: (count: number) => void;
  /** The price checker: whether it is on, and what is being looked at (null: nothing yet) */
  checking: boolean;
  check: PriceCheck | null;
  onStopChecking: () => void;
  onStartChecking: () => void;
}

/**
 * The items beside the cart: search or scan, the categories, then the grid. Its search text and
 * category are its own state, so typing re-renders this area and never the cart; the tiles are
 * memoised, so a key re-renders only the tiles whose result changed.
 */
export const ItemsArea = memo(function ItemsArea(props: ItemsAreaProps) {
  const {
    catalog,
    pieces,
    searchRef,
    inCart,
    pickingProduct,
    checking,
    onPickItem,
    onScanCode,
    onMultiplier,
  } = props;
  const digits = useDigits();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const results = useMemo(
    () => searchCatalog(catalog, query, { categoryId: category, limit: 60 }),
    [catalog, query, category],
  );
  const today = businessDateOf(
    Date.now(),
    catalog.settings?.timezone ?? 'UTC',
    catalog.settings?.businessDayCutoff ?? '00:00',
  );
  // Sold-out tiles go last (stable: the order of the rest is kept)
  const entries = useMemo(() => {
    const all = gridEntries(results, pieces);
    const out = (e: GridEntry) => isSoldOut(e.kind === 'model' ? e.pieces : [e.item], today);
    return [...all.filter((e) => !out(e)), ...all.filter(out)];
  }, [results, pieces, today]);
  // «الأكثر بيعاً»: a short strip of the usual tiles, only while no search or category narrows the grid
  const best = useMemo(() => {
    if (query || category !== null || !props.bestSellers?.length) return [];
    const top = new Set(props.bestSellers);
    const firstOf = new Map<string, CatalogItem>();
    for (const item of catalog.items)
      if (top.has(item.productId) && !firstOf.has(item.productId)) firstOf.set(item.productId, item);
    const items = props.bestSellers.flatMap((id) => firstOf.get(id) ?? []);
    return gridEntries(items, pieces).filter(
      (e) => !isSoldOut(e.kind === 'model' ? e.pieces : [e.item], today),
    );
  }, [query, category, props.bestSellers, catalog.items, pieces, today]);
  // Photos in the grid where the products have any; one tap turns them off for a compact grid (kept on this device)
  // …judged on what is in view: a category with no picture at all has nothing to hide
  const anyPhoto = useMemo(() => results.some((i) => Boolean(i.imageUrl)), [results]);
  const [photosOff, setPhotosOff] = useState(() => {
    try {
      return localStorage.getItem(PHOTOS_OFF_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (photosOff) localStorage.setItem(PHOTOS_OFF_KEY, '1');
      else localStorage.removeItem(PHOTOS_OFF_KEY);
    } catch {
      // Storage is closed: the choice lasts until the page is reloaded
    }
  }, [photosOff]);
  // Compact tiles (smaller, a little less to read): one tap, kept on this device
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem(COMPACT_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (compact) localStorage.setItem(COMPACT_KEY, '1');
      else localStorage.removeItem(COMPACT_KEY);
    } catch {
      // Storage is closed: the choice lasts until the page is reloaded
    }
  }, [compact]);
  // The picture's place (photo or letter) stays unless the cashier chose the compact grid, offered where photos exist
  const photos = anyPhoto && !photosOff;
  // A dollar-priced tile says what it comes to in the till's currency
  // An item with no photo draws what it is (shoes, a key for a rental…): the same helper as the lists and the shop
  const iconOf = useMemo(() => {
    const names = new Map(catalog.categories.map((c) => [c.id, c.name]));
    const sectors = catalog.settings?.sectors ?? [];
    return (item: CatalogItem): Icon =>
      placeholderIconFor({
        categoryName: item.categoryId
          ? names.get(catalog.rootOf.get(item.categoryId) ?? item.categoryId)
          : null,
        name: item.productName ?? item.name,
        sectors,
        isService: item.isService ?? false,
      });
  }, [catalog.categories, catalog.rootOf, catalog.settings?.sectors]);
  // Stock levels reach this till: an item with none yet says «لا مخزون» (a new product)
  const stockTracked = useMemo(
    () => catalog.items.some((i) => typeof i.stockQty === 'number'),
    [catalog.items],
  );
  const fx = useMemo<TileFx | null>(
    () => (catalog.settings ? { base: catalog.settings.baseCurrency, rates: catalog.rates } : null),
    [catalog.settings, catalog.rates],
  );

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('');
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = toLatinDigits(query.trim());
    const qty = /^(\d{1,3})\s*[*×]$/.exec(value);
    if (qty) {
      onMultiplier(Number(qty[1]));
      setQuery('');
      return;
    }
    const hit = catalog.byBarcode.get(barcodeKey(value));
    if (hit) onPickItem(hit.item, hit);
    else if (results.length === 1) onPickItem(results[0]!);
    else if (/^\d{6,}$/.test(value)) onScanCode(value);
    else return;
    setQuery('');
  }

  return (
    <>
      <div className="flex shrink-0 gap-2 sm:gap-3">
        <TextField
          ref={searchRef}
          type="search"
          label="ابحث أو امسح الباركود"
          hideLabel
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          placeholder="ابحث أو امسح الباركود"
          autoComplete="off"
          aria-keyshortcuts="F2"
          className="min-w-0 flex-1"
          inputClassName="[&::-webkit-search-cancel-button]:appearance-none"
          startAdornment={<SearchIcon size={20} className="ms-4" />}
          endAdornment={
            <span className="me-1 flex shrink-0 items-center gap-2">
              {props.multiplier ? (
                <span
                  className="num rounded-small bg-brand-soft px-2.5 py-1 text-base font-bold text-brand-ink"
                  aria-label={`الكمية التالية ${props.multiplier}`}
                >
                  ×{displayNumber(String(props.multiplier), digits)}
                </span>
              ) : null}
              {query ? (
                <IconButton
                  label="امسح البحث"
                  size="md"
                  icon={<CloseIcon size={20} />}
                  onClick={() => setQuery('')}
                />
              ) : (
                <span className="hidden items-center gap-2 pe-3 text-sm whitespace-nowrap text-ink-subtle lg:flex">
                  <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                  القارئ جاهز
                  <Kbd>F2</Kbd>
                </span>
              )}
            </span>
          }
        />
        <Button
          variant="secondary"
          icon={<BarcodeIcon size={20} />}
          aria-pressed={checking}
          aria-keyshortcuts="F9"
          onClick={checking ? props.onStopChecking : props.onStartChecking}
          className="max-sm:px-3.5"
        >
          {/* A phone: the barcode glyph alone beside the search, the words stay for screen readers */}
          <span className="max-sm:sr-only">سعر صنف</span>
          <Kbd className="max-sm:hidden">F9</Kbd>
        </Button>
        {props.hasLastLines ? (
          <Button
            variant="secondary"
            icon={<RepeatIcon size={20} />}
            onClick={props.onRepeatLast}
            aria-label="كرّر آخر طلب"
            title="كرّر آخر طلب"
            className="max-sm:px-3.5"
          >
            <span className="max-sm:sr-only">كرّر آخر طلب</span>
          </Button>
        ) : null}
      </div>
      {checking ? (
        <section
          aria-label="سعر صنف"
          className="flex shrink-0 flex-col gap-3 rounded-card border border-info/20 bg-info-soft p-4 text-info-ink"
        >
          <div className="flex items-center gap-3">
            <InfoIcon size={20} className="shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-semibold">
              {props.check
                ? 'لا يُضاف شيء إلى السلة هنا.'
                : 'امسح صنفاً أو اختره لترى سعره والمتوفر منه. لا يُضاف شيء إلى السلة.'}
            </p>
            <Button
              variant="secondary"
              size="md"
              icon={<CloseIcon size={20} />}
              onClick={props.onStopChecking}
            >
              أغلق
              <Kbd>Esc</Kbd>
            </Button>
          </div>
          {props.check ? (
            <PriceCheckCard
              check={props.check}
              today={businessDateOf(
                Date.now(),
                props.catalog.settings?.timezone ?? 'UTC',
                props.catalog.settings?.businessDayCutoff ?? '00:00',
              )}
            />
          ) : null}
        </section>
      ) : null}
      {props.notice ? (
        // A zero-height slot: the notice floats over the top of the grid, so nothing below it jumps
        <div className="relative z-20 -mb-4 h-0 shrink-0">
          <div
            role="alert"
            className={cn(
              'absolute inset-x-0 top-0 flex items-center gap-3 rounded-card border py-1 ps-4 pe-1 text-sm shadow-e2 motion-safe:animate-rise',
              props.notice.tone === 'warning'
                ? 'border-warning/20 bg-warning-soft text-warning-ink'
                : 'border-info/20 bg-info-soft text-info-ink',
            )}
          >
            {props.notice.tone === 'warning' ? (
              <WarningIcon size={20} className="shrink-0" />
            ) : (
              <InfoIcon size={20} className="shrink-0" />
            )}
            <span className="min-w-0 flex-1 py-2 font-semibold">{props.notice.text}</span>
            <IconButton
              label="أخفِ التنبيه"
              size="md"
              icon={<CloseIcon size={20} />}
              onClick={props.onDismissNotice}
            />
          </div>
        </div>
      ) : null}
      {catalog.categories.length > 0 ? (
        <div
          role="group"
          aria-label="التصنيفات"
          className="-m-1 flex shrink-0 gap-2 overflow-x-auto p-1 scrollbar-none sm:flex-wrap sm:overflow-visible"
        >
          {[{ id: null, name: 'الكل' }, ...catalog.categories].map((c) => {
            const on = !query && category === c.id;
            return (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setCategory(c.id);
                  setQuery('');
                }}
                className={cn(
                  CONTROL_HEIGHT.touch,
                  'shrink-0 rounded-small border px-5 text-base font-semibold whitespace-nowrap max-sm:min-h-11 max-sm:px-4 transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard',
                  on
                    ? 'border-brand/30 bg-brand-soft text-brand-ink'
                    : 'border-line-control/50 bg-surface text-ink-muted shadow-e1 hover:bg-surface-muted hover:text-ink',
                )}
              >
                {c.name}
              </button>
            );
          })}
          {/* The two view switches sit apart at the row's end, drawn as buttons: not a last category that taps nothing */}
          {results.length > 0 ? (
            <span className="ms-auto flex shrink-0 gap-2">
              <IconButton
                variant="secondary"
                size="md"
                icon={<GridIcon size={20} />}
                label={compact ? 'عرض عادي' : 'عرض مضغوط'}
                aria-pressed={compact}
                onClick={() => setCompact((v) => !v)}
              />
              {anyPhoto ? (
                <Button
                  variant="secondary"
                  size="md"
                  className="max-sm:min-h-11"
                  aria-pressed={photos}
                  onClick={() => setPhotosOff(photos)}
                >
                  {photos ? 'أخفِ الصور' : 'أظهر الصور'}
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {results.length === 0 ? (
        <EmptyState
          icon={catalog.items.length === 0 ? ProductsIcon : SearchIcon}
          title={catalog.items.length === 0 ? 'لا أصناف على هذا الجهاز بعد' : 'لا يوجد صنف بهذا الاسم'}
          description={
            catalog.items.length === 0
              ? 'تصل الأصناف مع أول اتصال بالإنترنت.'
              : 'جرّب كلمة أقصر، أو امسح الباركود.'
          }
        />
      ) : (
        <BranchStock.Provider value={(catalog.staff.branches?.length ?? 0) > 1}>
          <Grid
            entries={entries}
            best={best}
            inCart={inCart}
            pickingProduct={pickingProduct}
            today={today}
            photos={photos}
            compact={compact}
            stockTracked={stockTracked}
            fx={fx}
            iconOf={iconOf}
            // Taps on tiles only: right after a dialog closes, its second click must not pick a tile
            onPickItem={(item, hit) => {
              if (!clicksSwallowed()) onPickItem(item, hit);
            }}
            onPickModel={(productId, size) => {
              if (!clicksSwallowed()) props.onPickModel(productId, size);
            }}
          />
        </BranchStock.Provider>
      )}
    </>
  );
});

/** More than one branch: a tile's «متوفر N» is this branch's stock, and says «هنا» */
const BranchStock = createContext(false);

/** The tiles. A tile is memoised on what it shows, so the grid re-renders only what changed. */
const Grid = memo(function Grid({
  entries,
  best,
  inCart,
  pickingProduct,
  today,
  photos,
  compact,
  stockTracked,
  fx,
  iconOf,
  onPickItem,
  onPickModel,
}: {
  photos: boolean;
  compact: boolean;
  stockTracked: boolean;
  fx: TileFx | null;
  iconOf: (item: CatalogItem) => Icon;
  entries: readonly GridEntry[];
  best: readonly GridEntry[];
  inCart: ReadonlySet<string>;
  pickingProduct: string | null;
  today: string;
  onPickItem: ItemsAreaProps['onPickItem'];
  onPickModel: ItemsAreaProps['onPickModel'];
}) {
  const tile = (entry: GridEntry) =>
    entry.kind === 'model' ? (
      <ModelTile
        entry={entry}
        picking={pickingProduct === entry.productId}
        inCart={entry.pieces.some((p) => inCart.has(p.variantId))}
        today={today}
        photos={photos}
        compact={compact}
        stockTracked={stockTracked}
        fx={fx}
        Kind={iconOf(entry.lead)}
        onPick={onPickModel}
      />
    ) : (
      <ItemTileMemo
        item={entry.item}
        inCart={inCart.has(entry.item.variantId)}
        today={today}
        photos={photos}
        compact={compact}
        stockTracked={stockTracked}
        fx={fx}
        Kind={iconOf(entry.item)}
        onPick={onPickItem}
      />
    );
  return (
    // overflow-x hidden: the negative margin and the tiles' shadows must not make a sideways scrollbar
    <div className="-m-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1 [scrollbar-width:thin]">
      {best.length > 0 ? (
        <section aria-label="الأكثر بيعاً" className="mb-3 flex items-center gap-2">
          <h3 className="shrink-0 text-sm font-semibold text-ink-muted">الأكثر بيعاً</h3>
          <ul className="-m-1 flex min-w-0 gap-2 overflow-x-auto p-1 scrollbar-none">
            {best.map((entry) => (
              <li key={entry.kind === 'model' ? entry.productId : entry.item.variantId} className="shrink-0">
                <button
                  type="button"
                  className="min-h-10 max-w-40 truncate rounded-full border border-line-control bg-surface px-3 text-sm font-semibold text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted"
                  onClick={() =>
                    entry.kind === 'model' ? onPickModel(entry.productId) : onPickItem(entry.item)
                  }
                >
                  {entry.kind === 'model' ? entry.name : entry.item.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul
        aria-label="الأصناف"
        className={cn(
          'grid content-start items-stretch gap-3',
          compact
            ? 'grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2'
            : 'grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]',
        )}
      >
        {entries.map((entry) => (
          <li key={entry.kind === 'model' ? entry.productId : entry.item.variantId}>{tile(entry)}</li>
        ))}
      </ul>
    </div>
  );
});

const ItemTileMemo = memo(function ItemTileMemo({
  item,
  inCart,
  today,
  photos,
  compact,
  stockTracked,
  fx,
  Kind,
  onPick,
}: {
  item: CatalogItem;
  inCart: boolean;
  today: string;
  photos: boolean;
  compact: boolean;
  stockTracked: boolean;
  fx: TileFx | null;
  Kind: Icon;
  onPick: ItemsAreaProps['onPickItem'];
}) {
  const note = fx ? dollarNote(item.price.priceMinor, item.price.currency, fx) : null;
  return (
    <ItemTile
      name={item.name}
      priceMinor={item.price.priceMinor}
      currency={item.price.currency}
      {...(item.isService && item.price.priceMinor === 0 ? { priceLabel: 'السعر عند البيع' } : {})}
      {...(note ? { priceNote: note } : {})}
      placeholder={<Kind size={24} />}
      weighed={item.unit?.allowsFraction ?? false}
      {...(photos && item.imageUrl ? { imageUrl: item.imageUrl } : {})}
      {...(photos && !item.imageUrl && !item.isService ? { pictureSlot: true } : {})}
      selected={inCart}
      soldOut={isSoldOut([item], today)}
      extra={<TileMarks pieces={[item]} today={today} none={stockTracked} />}
      {...(compact || item.isService ? { compact: true } : {})}
      onSelect={() => onPick(item)}
      className="h-full w-full"
    />
  );
});

const ModelTile = memo(function ModelTile({
  entry,
  picking,
  inCart,
  today,
  photos,
  compact,
  stockTracked,
  fx,
  Kind,
  onPick,
}: {
  entry: Extract<GridEntry, { kind: 'model' }>;
  picking: boolean;
  inCart: boolean;
  today: string;
  photos: boolean;
  compact: boolean;
  stockTracked: boolean;
  fx: TileFx | null;
  Kind: Icon;
  onPick: ItemsAreaProps['onPickModel'];
}) {
  const price = lowestPrice(entry.pieces);
  const sizes = useMemo(() => sizeStock(entry.pieces), [entry.pieces]);
  const note = fx ? dollarNote(price.priceMinor, price.currency, fx) : null;
  return (
    <ItemTile
      name={entry.name}
      priceMinor={price.priceMinor}
      currency={price.currency}
      {...(sizes ? {} : { detail: piecesText(entry.pieces.length) })}
      {...(sizes
        ? {
            chips: (
              <SizeChips
                sizes={sizes}
                onPick={(s) => onPick(entry.productId, { option: s.option, value: s.value })}
              />
            ),
          }
        : {})}
      soldOut={isSoldOut(entry.pieces, today)}
      {...(note ? { priceNote: note } : {})}
      placeholder={<Kind size={24} />}
      {...(photos && entry.lead.imageUrl ? { imageUrl: entry.lead.imageUrl } : {})}
      {...(photos && !entry.lead.imageUrl ? { pictureSlot: true } : {})}
      selected={picking || inCart}
      extra={<TileMarks pieces={entry.pieces} today={today} none={stockTracked} />}
      {...(compact ? { compact: true } : {})}
      onSelect={() => onPick(entry.productId)}
      className="h-full w-full"
    />
  );
});

/** Nothing can be sold of these pieces (a known stock at or below zero): the tile dims and sinks to the end */
function isSoldOut(pieces: readonly CatalogItem[], today: string): boolean {
  const stock = tileInfo(pieces, today).stockQty;
  return stock !== null && stock <= 0;
}

/** «S 3 · M 1 · L»: the sizes of a model with what is left of each, a sold-out size struck through */
function SizeChips({
  sizes,
  onPick,
}: {
  sizes: readonly { option: string; value: string; inStock: boolean; left: number | null }[];
  onPick: (size: { option: string; value: string }) => void;
}) {
  const digits = useDigits();
  return (
    <span
      role="group"
      aria-label="المقاسات"
      className="flex flex-wrap gap-1.5 text-[0.8125rem] font-semibold"
    >
      {sizes.map((s) =>
        s.inStock ? (
          // A size is a button of its own beside the tile's button: tab, Enter and a screen reader reach it
          <button
            key={s.value}
            type="button"
            aria-label={`${s.value}${s.left !== null ? ` المتوفر ${formatQuantity(s.left, digits)}` : ''}`}
            onClick={() => onPick(s)}
            className="min-h-7 touch-manipulation rounded-small bg-surface-muted px-2 text-[0.8125rem] font-semibold whitespace-nowrap text-ink pointer-coarse:min-h-9"
          >
            <bdi aria-hidden="true">
              {s.value}
              {s.left !== null ? (
                <span className="num ms-1 text-[0.8125rem] font-normal text-ink-muted">
                  · {formatQuantity(s.left, digits)}
                </span>
              ) : null}
            </bdi>
          </button>
        ) : (
          <bdi key={s.value} className="px-2 py-0.5 text-ink-muted line-through decoration-2">
            {s.value}
            <span className="sr-only"> نفد</span>
          </bdi>
        ),
      )}
    </span>
  );
}

/** What the till needs to say a foreign price in its own currency */
export interface TileFx {
  base: CurrencyCode;
  rates: Catalog['rates'];
}

/** «≈ 5,850 ل.س» under a price that is not in the till's currency; null when the rate is not known */
export function dollarNote(priceMinor: number, currency: CurrencyCode, fx: TileFx): ReactNode {
  if (currency === fx.base || priceMinor === 0) return null;
  try {
    const minor = convert(priceMinor, currency, fx.base, rateFor(fx.rates, currency, fx.base));
    return (
      <span dir="rtl">
        ≈ <Money minor={minor} currency={fx.base} className="font-semibold" />
      </span>
    );
  } catch {
    return null;
  }
}

/** Under a tile's price: what is left, the nearest expiry (amber, then red) and «برقم تسلسلي» */
function TileMarks({
  pieces,
  today,
  none = false,
}: {
  pieces: readonly CatalogItem[];
  today: string;
  /** Stock levels reach this till, so an item with no level yet has nothing on the shelf */
  none?: boolean;
}) {
  const digits = useDigits();
  const here = useContext(BranchStock);
  const info = tileInfo(pieces, today);
  const unsellable = info.expiredQty + info.blockedQty;
  if (none && info.stockQty === null && !pieces.every((p) => p.isService)) {
    return <span className="num text-xs font-medium text-ink-muted">نفد</span>;
  }
  if (
    info.stockQty === null &&
    !info.expiry &&
    !info.tracksSerial &&
    unsellable === 0 &&
    info.rentedCount === 0
  )
    return null;
  // «المتوفر للبيع» leaves out what is rented out as well as the expired and the blocked: one sentence for all of them
  const onShelf = info.stockQty === null ? null : Math.max(0, info.stockQty - info.rentedCount * 1000);
  const nothingSellable = (onShelf ?? 0) <= 0;
  const why = info.blockedQty === 0 ? 'منتهية' : info.expiredQty === 0 ? 'موقوفة' : 'غير صالحة';
  return (
    <>
      {onShelf !== null ? (
        <span className={cn('num text-xs font-medium', nothingSellable ? 'text-ink-muted' : 'text-ink')}>
          {nothingSellable ? 'نفد' : `المتوفر ${formatQuantity(onShelf, digits)}${here ? ' هنا' : ''}`}
        </span>
      ) : null}
      {/* What is left out of the count (halted, expired): one small «⚠ 3 موقوفة» chip, never a second sentence */}
      {unsellable > 0 ? (
        <Badge tone={nothingSellable ? 'warning' : 'neutral'}>
          ⚠ {formatQuantity(unsellable, digits)} {why}
        </Badge>
      ) : null}
      {info.expiry ? (
        <span title="أقرب انتهاء أولاً">
          <Badge tone={info.expiry.tone}>
            {expiryText(info.expiry.days, (n) => displayNumber(String(n), digits))}
          </Badge>
        </span>
      ) : null}
      {info.rentedCount > 0 ? (
        <Badge tone="neutral">{formatQuantity(info.rentedCount * 1000, digits)} مؤجَّر</Badge>
      ) : null}
      {info.tracksSerial ? <Badge tone="neutral">برقم تسلسلي</Badge> : null}
    </>
  );
}

/** «سعر صنف»: the product's name, then a row for each size and colour with its price and what is left. */
export function PriceCheckCard({ check, today }: { check: PriceCheck; today?: string }) {
  const digits = useDigits();
  // The product's name is the heading: a piece shows only what sets it apart (size, colour), never the name again
  const label = (piece: CatalogItem) =>
    (piece.attributes ?? []).length > 0
      ? piece.attributes!.map((a) => a.value).join(' · ')
      : piece.name === check.name
        ? check.pieces.length > 1
          ? 'الأساسي'
          : ''
        : piece.name;
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface p-3 text-ink">
      <h3 className="text-lg font-semibold">
        <bdi>{check.name}</bdi>
      </h3>
      {check.pack ? (
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>
            {check.pack.name ? <bdi>{check.pack.name}</bdi> : 'العلبة'} (
            {formatQuantity(check.pack.qty, digits)} {pieceWord(check.pack.qty)})
          </span>
          <Money minor={check.pack.priceMinor} currency={check.pack.currency} className="font-bold" />
        </p>
      ) : null}
      <ul aria-label="أسعار الصنف" className="flex flex-col divide-y divide-line">
        {check.pieces.map((piece) => {
          // What can be sold: a piece that keeps batches leaves out the expired and blocked ones (display only)
          const batched = today && Array.isArray(piece.stockBatches) ? piece.stockBatches : null;
          const stateQty = (state: 'expired' | 'blocked') =>
            batched ? batched.reduce((sum, b) => sum + (batchState(b, today!) === state ? b.qty : 0), 0) : 0;
          const expiredQty = stateQty('expired');
          const unsellable = expiredQty + stateQty('blocked');
          const why = expiredQty === 0 ? 'موقوفة' : expiredQty === unsellable ? 'منتهية' : 'منتهية أو موقوفة';
          const boxes = check.packs?.[piece.variantId] ?? [];
          // Never more than the stock itself says: the batch ledger can run a few pieces over it
          const sellable = batched ? sellableQty(batched, today!) : null;
          const left =
            sellable === null
              ? (piece.stockQty ?? null)
              : piece.stockQty === null || piece.stockQty === undefined
                ? sellable
                : Math.min(sellable, piece.stockQty);
          return (
            <li
              key={piece.variantId}
              className={cn(
                'flex min-h-12 items-center gap-3 py-2',
                piece.variantId === check.focus && 'font-semibold',
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                <bdi>{label(piece) || 'سعر القطعة'}</bdi>
                {piece.unit?.allowsFraction ? (
                  <span className="text-sm text-ink-muted"> · للكيلو</span>
                ) : null}
                {boxes.map((box) => (
                  <span key={box.qty} className="block text-sm font-normal text-ink-muted">
                    {box.name ? <bdi>{box.name}</bdi> : 'علبة'} ({formatQuantity(box.qty, digits)}{' '}
                    {pieceWord(box.qty)}){' '}
                    <Money
                      minor={box.priceMinor}
                      currency={box.currency}
                      className="font-semibold text-ink"
                    />
                  </span>
                ))}
              </span>
              {/* The price and what is left of it sit together, not at opposite ends of the row */}
              <div className="flex max-w-[22rem] shrink-0 items-baseline gap-3">
                <Money minor={piece.price.priceMinor} currency={piece.price.currency} className="font-bold" />
                <span
                  className={cn(
                    'num max-w-[14rem] shrink-0 text-start text-sm',
                    left === null
                      ? 'text-ink-subtle'
                      : left <= 0
                        ? 'font-semibold text-danger-ink'
                        : 'text-ink-muted',
                  )}
                >
                  {left === null
                    ? 'المتوفر غير معروف'
                    : left <= 0
                      ? 'نفد'
                      : `المتوفر ${
                          piece.variantId === check.focus && check.pack
                            ? stockInPacks(left, check.pack, digits, (q) => formatQuantity(q, digits))
                            : formatQuantity(left, digits)
                        }`}
                  {unsellable > 0 ? (
                    <span className="block text-xs font-semibold text-danger-ink">
                      غير صالح للبيع {formatQuantity(unsellable, digits)} ({why})
                    </span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {check.pieces
        .filter((p) => p.variantId === check.focus || check.pieces.length === 1)
        .map((p) => {
          // Every batch with what is left in it; the expired and blocked ones are marked, not hidden
          const rows =
            today && Array.isArray(p.stockBatches)
              ? [...p.stockBatches]
                  // The no-batch row shows too, even below zero, so the rows add up to what is left
                  .filter((b) => b.qty > 0 || (!b.batchNo && b.qty !== 0))
                  .sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'))
                  .map((b) => ({
                    batchNo: b.batchNo,
                    expiry: b.expiry,
                    qty: b.qty as number | null,
                    state: batchState(b, today),
                  }))
              : (p.shelfBatches ?? []).map((b) => ({
                  batchNo: b.batchNo,
                  expiry: b.expiry as string | null,
                  qty: null as number | null,
                  state: today && b.expiry < today ? ('expired' as const) : ('ok' as const),
                }));
          return rows.length > 0 ? (
            <ul
              key={p.variantId}
              aria-label="الدفعات وتواريخ الصلاحية"
              className="flex flex-col gap-1 text-sm"
            >
              {rows.map((b, i) => (
                <li
                  key={`${b.batchNo ?? ''}-${i}`}
                  className={cn(
                    'flex flex-wrap items-center gap-x-2',
                    b.state === 'ok' || b.state === 'empty' ? 'text-ink-muted' : 'text-danger-ink',
                  )}
                >
                  <span>
                    {b.batchNo ? (
                      <>
                        دفعة <bdi dir="ltr">{b.batchNo}</bdi>
                      </>
                    ) : (
                      'بلا دفعة'
                    )}
                  </span>
                  {b.expiry ? (
                    <span>
                      · تنتهي <bdi>{dayText(b.expiry, digits)}</bdi>
                    </span>
                  ) : null}
                  {b.qty !== null ? <span>· الكمية {formatQuantity(b.qty, digits)}</span> : null}
                  {b.state === 'expired' ? <Badge tone="danger">منتهية</Badge> : null}
                  {b.state === 'blocked' ? <Badge tone="danger">موقوفة</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null;
        })}
    </div>
  );
}
