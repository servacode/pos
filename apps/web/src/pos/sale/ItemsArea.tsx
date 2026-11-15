import { memo, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
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
  IconButton,
  InfoIcon,
  ItemTile,
  Money,
  ProductsIcon,
  RetryIcon,
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

const PHOTOS_OFF_KEY = 'tillPhotosOff';

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
  onPickModel: (productId: string) => void;
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
  // Photos in the grid where the products have any; one tap turns them off for a compact grid (kept on this device)
  const anyPhoto = useMemo(() => catalog.items.some((i) => Boolean(i.imageUrl)), [catalog.items]);
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
  // The picture's place (photo or letter) stays unless the cashier chose the compact grid, offered where photos exist
  const photos = !(anyPhoto && photosOff);
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
      <div className="flex shrink-0 flex-wrap gap-3 sm:flex-nowrap">
        <TextField
          ref={searchRef}
          type="search"
          label="ابحث أو امسح الباركود"
          hideLabel
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          placeholder="ابحث باسم الصنف أو امسح الباركود"
          autoComplete="off"
          aria-keyshortcuts="F2"
          className="min-w-0 flex-1 basis-full sm:basis-0"
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
        >
          سعر صنف
          <Kbd>F9</Kbd>
        </Button>
        {props.hasLastLines ? (
          <Button variant="secondary" icon={<RetryIcon size={20} />} onClick={props.onRepeatLast}>
            كرّر آخر طلب
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
        <div
          role="alert"
          className={cn(
            'flex shrink-0 items-center gap-3 rounded-card border py-1 ps-4 pe-1 text-sm motion-safe:animate-rise',
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
      ) : null}
      {catalog.categories.length > 0 ? (
        <div
          role="group"
          aria-label="التصنيفات"
          className="-m-1 flex shrink-0 gap-2 overflow-x-auto p-1 scrollbar-none"
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
                  'shrink-0 rounded-small border px-5 text-base font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard',
                  on
                    ? 'border-brand/30 bg-brand-soft text-brand-ink'
                    : 'border-line-control/50 bg-surface text-ink-muted shadow-e1 hover:bg-surface-muted hover:text-ink',
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {anyPhoto && results.length > 0 ? (
        <div className="-mt-1 flex shrink-0 justify-end">
          <Button variant="ghost" size="md" aria-pressed={photos} onClick={() => setPhotosOff(photos)}>
            {photos ? 'أخفِ الصور' : 'أظهر الصور'}
          </Button>
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
        <Grid
          entries={entries}
          inCart={inCart}
          pickingProduct={pickingProduct}
          today={today}
          photos={photos}
          fx={fx}
          iconOf={iconOf}
          onPickItem={onPickItem}
          onPickModel={props.onPickModel}
        />
      )}
    </>
  );
});

/** The tiles. A tile is memoised on what it shows, so the grid re-renders only what changed. */
const Grid = memo(function Grid({
  entries,
  inCart,
  pickingProduct,
  today,
  photos,
  fx,
  iconOf,
  onPickItem,
  onPickModel,
}: {
  photos: boolean;
  fx: TileFx | null;
  iconOf: (item: CatalogItem) => Icon;
  entries: readonly GridEntry[];
  inCart: ReadonlySet<string>;
  pickingProduct: string | null;
  today: string;
  onPickItem: ItemsAreaProps['onPickItem'];
  onPickModel: (productId: string) => void;
}) {
  return (
    // overflow-x hidden: the negative margin and the tiles' shadows must not make a sideways scrollbar
    <div className="-m-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1 [scrollbar-width:thin]">
      <ul
        aria-label="الأصناف"
        className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-3"
      >
        {entries.map((entry) =>
          entry.kind === 'model' ? (
            <li key={entry.productId}>
              <ModelTile
                entry={entry}
                picking={pickingProduct === entry.productId}
                inCart={entry.pieces.some((p) => inCart.has(p.variantId))}
                today={today}
                photos={photos}
                fx={fx}
                Kind={iconOf(entry.lead)}
                onPick={onPickModel}
              />
            </li>
          ) : (
            <li key={entry.item.variantId}>
              <ItemTileMemo
                item={entry.item}
                inCart={inCart.has(entry.item.variantId)}
                today={today}
                photos={photos}
                fx={fx}
                Kind={iconOf(entry.item)}
                onPick={onPickItem}
              />
            </li>
          ),
        )}
      </ul>
    </div>
  );
});

const ItemTileMemo = memo(function ItemTileMemo({
  item,
  inCart,
  today,
  photos,
  fx,
  Kind,
  onPick,
}: {
  item: CatalogItem;
  inCart: boolean;
  today: string;
  photos: boolean;
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
      pictureSlot={photos}
      selected={inCart}
      soldOut={isSoldOut([item], today)}
      extra={<TileMarks pieces={[item]} today={today} />}
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
  fx,
  Kind,
  onPick,
}: {
  entry: Extract<GridEntry, { kind: 'model' }>;
  picking: boolean;
  inCart: boolean;
  today: string;
  photos: boolean;
  fx: TileFx | null;
  Kind: Icon;
  onPick: (productId: string) => void;
}) {
  const price = lowestPrice(entry.pieces);
  const sizes = useMemo(() => sizeStock(entry.pieces), [entry.pieces]);
  const note = fx ? dollarNote(price.priceMinor, price.currency, fx) : null;
  return (
    <ItemTile
      name={entry.name}
      priceMinor={price.priceMinor}
      currency={price.currency}
      detail={sizes ? <SizeChips sizes={sizes} /> : piecesText(entry.pieces.length)}
      soldOut={isSoldOut(entry.pieces, today)}
      {...(note ? { priceNote: note } : {})}
      placeholder={<Kind size={24} />}
      pictureSlot={photos}
      initial={!photos}
      {...(photos && entry.lead.imageUrl ? { imageUrl: entry.lead.imageUrl } : {})}
      selected={picking || inCart}
      extra={<TileMarks pieces={entry.pieces} today={today} />}
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

/** «S M L»: the sizes in stock of a model, a sold-out size struck through */
function SizeChips({ sizes }: { sizes: readonly { value: string; inStock: boolean }[] }) {
  return (
    <span className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs font-semibold">
      {sizes.map((s) => (
        <bdi
          key={s.value}
          className={s.inStock ? 'text-ink-muted' : 'text-ink-subtle line-through decoration-1'}
        >
          {s.value}
          {s.inStock ? null : <span className="sr-only"> نفد</span>}
        </bdi>
      ))}
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
function TileMarks({ pieces, today }: { pieces: readonly CatalogItem[]; today: string }) {
  const digits = useDigits();
  const info = tileInfo(pieces, today);
  const unsellable = info.expiredQty + info.blockedQty;
  if (
    info.stockQty === null &&
    !info.expiry &&
    !info.tracksSerial &&
    unsellable === 0 &&
    info.rentedCount === 0
  )
    return null;
  const nothingSellable = (info.stockQty ?? 0) <= 0;
  const why = info.blockedQty === 0 ? 'منتهية' : info.expiredQty === 0 ? 'موقوفة' : 'غير صالحة';
  return (
    <>
      {info.stockQty !== null ? (
        <span
          className={cn('num text-xs font-medium', nothingSellable ? 'text-danger-ink' : 'text-ink-muted')}
        >
          {nothingSellable ? 'نفد' : `المتوفر ${formatQuantity(info.stockQty, digits)}`}
        </span>
      ) : null}
      {/* Red only when nothing can be sold; otherwise a muted note of what is left out of the count */}
      {unsellable > 0 ? (
        nothingSellable ? (
          <Badge tone="danger">{why}</Badge>
        ) : (
          <Badge tone="neutral">
            منها {formatQuantity(unsellable, digits)} {why}
          </Badge>
        )
      ) : null}
      {info.expiry ? (
        <Badge tone={info.expiry.tone}>
          {expiryText(info.expiry.days, (n) => displayNumber(String(n), digits))}
        </Badge>
      ) : null}
      {info.rentedCount > 0 ? (
        <Badge tone="neutral">منها {formatQuantity(info.rentedCount * 1000, digits)} مؤجَّر</Badge>
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
