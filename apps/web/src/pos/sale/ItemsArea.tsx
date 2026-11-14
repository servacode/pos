import { memo, useMemo, useState, type RefObject } from 'react';
import type { CurrencyCode } from '@serva/core/currencies';
import { toLatinDigits } from '@serva/core/text';
import { dayText } from '../../lib/dates';
import {
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
} from '@serva/ui';
import { barcodeKey, searchCatalog, type BarcodeHit, type Catalog, type CatalogItem } from '../catalog';
import { Kbd } from './Kbd';
import { gridEntries, lowestPrice, piecesText, type GridEntry } from './models';

export interface PriceCheck {
  /** The product's name */
  name: string;
  /** Its pieces (sizes, colours), or the one item */
  pieces: readonly CatalogItem[];
  /** The piece that was scanned, if one was */
  focus: string | null;
  /** The pack that was scanned (a box of 12): its name, size and price */
  pack?: { name: string | null; qty: number; priceMinor: number; currency: CurrencyCode } | null;
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
  const entries = useMemo(() => gridEntries(results, pieces), [results, pieces]);

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
          {props.check ? <PriceCheckCard check={props.check} /> : null}
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
  onPickItem,
  onPickModel,
}: {
  entries: readonly GridEntry[];
  inCart: ReadonlySet<string>;
  pickingProduct: string | null;
  onPickItem: ItemsAreaProps['onPickItem'];
  onPickModel: (productId: string) => void;
}) {
  return (
    // overflow-x hidden: the negative margin and the tiles' shadows must not make a sideways scrollbar
    <div className="-m-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1 [scrollbar-width:thin]">
      <ul
        aria-label="الأصناف"
        className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-3"
      >
        {entries.map((entry) =>
          entry.kind === 'model' ? (
            <li key={entry.productId}>
              <ModelTile
                entry={entry}
                picking={pickingProduct === entry.productId}
                inCart={entry.pieces.some((p) => inCart.has(p.variantId))}
                onPick={onPickModel}
              />
            </li>
          ) : (
            <li key={entry.item.variantId}>
              <ItemTileMemo item={entry.item} inCart={inCart.has(entry.item.variantId)} onPick={onPickItem} />
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
  onPick,
}: {
  item: CatalogItem;
  inCart: boolean;
  onPick: ItemsAreaProps['onPickItem'];
}) {
  return (
    <ItemTile
      name={item.name}
      priceMinor={item.price.priceMinor}
      currency={item.price.currency}
      weighed={item.unit?.allowsFraction ?? false}
      {...(item.imageUrl ? { imageUrl: item.imageUrl } : {})}
      pictureSlot
      selected={inCart}
      onSelect={() => onPick(item)}
      className="h-full w-full"
    />
  );
});

const ModelTile = memo(function ModelTile({
  entry,
  picking,
  inCart,
  onPick,
}: {
  entry: Extract<GridEntry, { kind: 'model' }>;
  picking: boolean;
  inCart: boolean;
  onPick: (productId: string) => void;
}) {
  const price = lowestPrice(entry.pieces);
  return (
    <ItemTile
      name={entry.name}
      priceMinor={price.priceMinor}
      currency={price.currency}
      detail={piecesText(entry.pieces.length)}
      pictureSlot
      {...(entry.lead.imageUrl ? { imageUrl: entry.lead.imageUrl } : {})}
      selected={picking || inCart}
      onSelect={() => onPick(entry.productId)}
      className="h-full w-full"
    />
  );
});

/** «سعر صنف»: the product's name, then a row for each size and colour with its price and what is left. */
export function PriceCheckCard({ check }: { check: PriceCheck }) {
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
            {check.pack.name ? <bdi>{check.pack.name}</bdi> : 'العبوة'} (
            {formatQuantity(check.pack.qty, digits)} قطعة)
          </span>
          <Money minor={check.pack.priceMinor} currency={check.pack.currency} className="font-bold" />
        </p>
      ) : null}
      <ul aria-label="أسعار الصنف" className="flex flex-col divide-y divide-line">
        {check.pieces.map((piece) => {
          const left = piece.stockQty ?? null;
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
              </span>
              <Money minor={piece.price.priceMinor} currency={piece.price.currency} className="font-bold" />
              <span
                className={cn(
                  'num w-28 shrink-0 text-end text-sm',
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
                    : `المتوفر ${formatQuantity(left, digits)}`}
              </span>
            </li>
          );
        })}
      </ul>
      {check.pieces
        .filter((p) => p.variantId === check.focus || check.pieces.length === 1)
        .map((p) =>
          p.shelfBatches && p.shelfBatches.length > 0 ? (
            <ul
              key={p.variantId}
              aria-label="الدفعات وتواريخ الصلاحية"
              className="flex flex-col gap-1 text-sm"
            >
              {p.shelfBatches.map((b, i) => (
                <li key={`${b.batchNo ?? ''}-${i}`} className="flex gap-2 text-ink-muted">
                  <span>دفعة {b.batchNo ? <bdi dir="ltr">{b.batchNo}</bdi> : '—'}</span>
                  <span>
                    · تنتهي <bdi>{dayText(b.expiry, digits)}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          ) : null,
        )}
    </div>
  );
}
