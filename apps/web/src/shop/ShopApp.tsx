import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import type { ShopCodeSent, ShopHome, ShopOrderPlaced, ShopOrderTrack, ShopProduct } from '@serva/core';
import {
  AddIcon,
  Alert,
  AlertCircleIcon,
  BackIcon,
  Badge,
  Banner,
  Button,
  CartIcon,
  CheckCircleIcon,
  ClockIcon,
  cn,
  CONTROL_HEIGHT,
  EmptyState,
  FullScreenLoader,
  IconButton,
  IconChip,
  InfoIcon,
  initialsOf,
  LogoMark,
  Money,
  OfferIcon,
  ProductsIcon,
  RemoveIcon,
  SearchField,
  Select,
  SendIcon,
  Skeleton,
  SkeletonText,
  StoreIcon,
  TextField,
  TextLink,
  ThemeToggle,
  TruckIcon,
  useDensity,
  type Density,
} from '@serva/ui';
import { ApiError, apiFetch, errorMessage } from '../lib/api';
import { counted } from '../pos/format';
import { canPick, cartCount, cartTotal, MAX_QTY, useShopCart, variantFor } from './cart';
import { openWhatsApp } from './open';

/**
 * The store's online shop (26 › المتجر الإلكتروني): its goods with their pictures, sizes and
 * colours on the shelf, a cart kept on the customer's phone, and the order: «اطلب عبر واتساب»
 * (saved for the store, then WhatsApp opens on the store's number with it written out) or, when the
 * store takes orders in the shop itself, a code to the customer's phone confirms it. Each order has
 * its page for the customer to follow. No sign-in, no app to install; made for a phone first.
 *
 * هوية 4, led by the store: its name and monogram in the header, its note in the strip above it,
 * and SERFA only in the footer's small «يعمل بنظام سيرفا».
 */
export function ShopApp() {
  const { slug = '' } = useParams();
  const [home, setHome] = useState<ShopHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cart = useShopCart(slug);
  const density = useDensity();

  useEffect(() => {
    let alive = true;
    apiFetch<ShopHome>(`/v1/shop/${encodeURIComponent(slug)}`)
      .then((h) => alive && setHome(h))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) {
    return (
      <main dir="rtl" className="grid min-h-dvh place-items-center bg-canvas p-6">
        <title>المتجر · Serva</title>
        <EmptyState
          icon={StoreIcon}
          title="المتجر غير متاح"
          description={error}
          className="w-full max-w-md bg-surface"
        />
      </main>
    );
  }
  if (!home) return <FullScreenLoader />;
  const base = `/shop/${slug}`;
  const count = cartCount(cart.lines);
  const { store } = home;

  return (
    <div dir="rtl" className="flex min-h-dvh flex-col bg-canvas text-ink">
      <title>{`${home.store.name} · المتجر`}</title>
      {store.note ? (
        <p className="border-b border-sidebar-line bg-sidebar px-4 py-2 text-center text-sm text-sidebar-ink">
          {store.note}
        </p>
      ) : null}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to={base} className="me-auto flex min-w-0 items-center gap-3 rounded-control">
            <IconChip>
              <span className="text-sm font-bold">{initialsOf(store.name)}</span>
            </IconChip>
            <span className="truncate text-lg font-bold">{store.name}</span>
          </Link>
          <Link
            to={`${base}/cart`}
            aria-label={`السلة، ${count} قطعة`}
            className={cn(
              CONTROL_HEIGHT[density],
              'inline-flex shrink-0 items-center gap-2 rounded-control border border-line-control/50 bg-surface ps-3 pe-2.5 text-sm font-semibold text-ink shadow-e1 transition-colors duration-120 ease-standard hover:bg-surface-muted',
            )}
          >
            <CartIcon className="text-brand-ink" />
            السلة
            <span
              className={cn(
                'num min-w-5.5 rounded-full px-1.5 text-center text-xs/5.5 font-bold',
                count > 0 ? 'bg-brand text-on-brand' : 'bg-surface-muted text-ink-muted',
              )}
            >
              {count}
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 lg:pt-8">
        <Routes>
          <Route index element={<Catalogue home={home} base={base} />} />
          <Route path="p/:id" element={<ProductView home={home} slug={slug} base={base} cart={cart} />} />
          <Route path="cart" element={<CartView home={home} slug={slug} base={base} cart={cart} />} />
          <Route path="o/:token" element={<TrackView slug={slug} base={base} />} />
        </Routes>
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span className="font-semibold text-ink">{store.name}</span>
            <span aria-hidden="true" className="text-ink-subtle">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-subtle">
              يعمل بنظام
              {/* The mark at 16: its own size-8 would win over a smaller size given to it. */}
              <span className="inline-flex [&_svg]:size-4">
                <LogoMark />
              </span>
              <span className="font-semibold text-ink-muted">سيرفا</span>
            </span>
          </p>
          <span className="flex items-center gap-4 text-sm">
            <TextLink href="/terms" target="_blank" rel="noopener">
              الشروط
            </TextLink>
            <TextLink href="/privacy" target="_blank" rel="noopener">
              الخصوصية
            </TextLink>
          </span>
          <ThemeToggle size="sm" />
        </div>
      </footer>
    </div>
  );
}

type Cart = ReturnType<typeof useShopCart>;

const digitsOf = (text: string) => [...text].filter((ch) => ch >= '0' && ch <= '9').join('');

/** «قطعة واحدة», «قطعتان», «3 قطع», «16 قطعة»: the count and its noun agree, as Arabic counts. */
const PIECES = ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'] as const;

/**
 * A link drawn as a button (هوية 4 › الزر), the density's control height: the way on to WhatsApp, to
 * the order's page and back to the goods, which stay links.
 */
const LINK_BUTTON = {
  primary:
    'inset-shadow-[0_1px_0] inset-shadow-highlight/15 bg-brand text-on-brand shadow-[0_1px_2px] shadow-mark-from/30 hover:bg-brand-hover',
  secondary: 'border border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
} as const;

function linkButton(variant: keyof typeof LINK_BUTTON, density: Density) {
  return cn(
    CONTROL_HEIGHT[density],
    'inline-flex items-center justify-center gap-2 rounded-control px-5 text-[0.9375rem] font-semibold transition-colors duration-120 ease-standard',
    LINK_BUTTON[variant],
  );
}

/** A piece without a picture: a soft tile with the goods' sign, never an empty box. */
function NoPicture({ large = false }: { large?: boolean }) {
  return (
    <span className="grid size-full place-items-center bg-brand-soft text-brand">
      <ProductsIcon size={large ? 48 : 32} />
    </span>
  );
}

/** The running offer's name (هوية 4 › Accent: the highlight chip), on the card and the page. */
function OfferTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent',
        className,
      )}
    >
      <OfferIcon size={16} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function Catalogue({ home, base }: { home: ShopHome; base: string }) {
  const density = useDensity();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const tops = home.categories.filter((c) => c.parentId === null);
  const rootOf = useMemo(() => {
    const parent = new Map(home.categories.map((c) => [c.id, c.parentId]));
    return (id: string | null) => {
      let at = id;
      const seen = new Set<string>();
      while (at && parent.get(at) && !seen.has(at)) {
        seen.add(at);
        at = parent.get(at)!;
      }
      return at;
    };
  }, [home.categories]);
  const inCategory = category
    ? home.products.filter((p) => rootOf(p.categoryId) === category)
    : home.products;
  // The search box narrows what the department shows, by the piece's name.
  const words = query.trim().toLocaleLowerCase('ar');
  const shown = words ? inCategory.filter((p) => p.name.toLocaleLowerCase('ar').includes(words)) : inCategory;
  const title = (category ? tops.find((c) => c.id === category)?.name : null) ?? 'كل البضاعة';
  // A shop without a single picture yet gets shorter tiles: a wall of tall empty frames looks unfinished.
  const media = home.products.some((p) => p.imageUrl) ? 'aspect-[4/5]' : 'aspect-[4/3]';
  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
            <p className="text-sm text-ink-muted">
              {counted(shown.length, PIECES)}
              {home.store.delivery ? ' · توصيل' : ''}
              {home.store.pickup ? ' · استلام من المحل' : ''}
            </p>
          </div>
          <SearchField
            label="ابحث في المتجر"
            placeholder="ابحث عن قطعة…"
            value={query}
            onValueChange={setQuery}
            className="w-full sm:w-80"
          />
        </div>
        {tops.length > 0 ? (
          <div
            role="group"
            aria-label="الأقسام"
            className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {[{ id: null, name: 'الكل' }, ...tops].map((c) => (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  CONTROL_HEIGHT[density],
                  'shrink-0 rounded-small border px-4 text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard select-none',
                  category === c.id
                    ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand'
                    : 'border-line-control/50 bg-surface text-ink-muted shadow-e1 hover:bg-surface-muted hover:text-ink',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="لا بضاعة هنا الآن"
          description={words ? 'لا قطعة بهذا الاسم. جرّب كلمة أخرى.' : 'جرّب قسماً آخر، أو عد لاحقاً.'}
        />
      ) : (
        <ul
          aria-label="البضاعة"
          className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4"
        >
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                to={`${base}/p/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1 transition-[box-shadow,border-color,translate] duration-120 ease-standard hover:border-line-control/50 hover:shadow-e2 motion-safe:hover:-translate-y-0.5"
              >
                <span className={cn('relative block overflow-hidden bg-surface-muted', media)}>
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'size-full object-cover transition-transform duration-200 ease-standard motion-safe:group-hover:scale-[1.03]',
                        !p.available && 'opacity-60',
                      )}
                    />
                  ) : (
                    <NoPicture />
                  )}
                  {p.offer ? (
                    <OfferTag className="absolute start-2 top-2 max-w-[calc(100%-1rem)] shadow-e1">
                      {p.offer}
                    </OfferTag>
                  ) : null}
                  {!p.available ? (
                    <span className="absolute inset-x-0 bottom-0 bg-surface/85 py-1.5 text-center text-xs font-semibold text-ink-muted backdrop-blur-sm">
                      نفد
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
                  <span className="line-clamp-2 text-[0.9375rem] font-semibold text-ink">{p.name}</span>
                  <span className="mt-auto flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[0.9375rem] text-ink">
                      {p.maxPriceMinor > p.priceMinor ? (
                        <span className="text-sm text-ink-muted">من </span>
                      ) : (
                        ''
                      )}
                      <Money
                        minor={p.priceMinor}
                        currency={p.currency}
                        className="font-bold"
                        unitClassName="text-xs font-semibold text-ink-subtle"
                      />
                    </span>
                    {p.wasPriceMinor ? (
                      <s aria-label="السعر قبل التنزيل" className="text-xs text-ink-subtle">
                        <Money minor={p.wasPriceMinor} currency={p.currency} />
                      </s>
                    ) : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ProductView({ home, slug, base, cart }: { home: ShopHome; slug: string; base: string; cart: Cart }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const density = useDensity();
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let alive = true;
    setProduct(null);
    apiFetch<ShopProduct>(`/v1/shop/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`)
      .then((p) => {
        if (!alive) return;
        setProduct(p);
        // An option with a single value is chosen already
        setChosen(
          Object.fromEntries(
            p.options.filter((o) => o.values.length === 1).map((o) => [o.name, o.values[0]!]),
          ),
        );
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [slug, id]);

  const back = (
    <Link
      to={base}
      className="inline-flex w-fit items-center gap-1.5 rounded-small text-sm font-semibold text-ink-muted transition-colors duration-120 ease-standard hover:text-ink"
    >
      <BackIcon size={16} />
      كل البضاعة
    </Link>
  );

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!product) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-x-10 lg:gap-x-14">
        <p className="sr-only">لحظة…</p>
        <Skeleton className="aspect-[4/5] w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-7 w-1/3" />
          <SkeletonText lines={3} className="mt-4" />
        </div>
      </div>
    );
  }
  const variant = variantFor(product, chosen);
  // The picture of a chosen colour first
  const images = product.images;
  const matching = images.findIndex((i) => i.optionValue && Object.values(chosen).includes(i.optionValue));
  const main = images[matching >= 0 && shown === 0 ? matching : shown] ?? images[0];
  const cheapest = product.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
  const price = variant?.priceMinor ?? cheapest.priceMinor;
  const was = (variant ?? cheapest).wasPriceMinor;

  return (
    <>
      {back}
      <article
        aria-label={product.name}
        className="flex flex-col gap-6 md:grid md:grid-cols-2 md:grid-rows-[auto_auto_1fr] md:items-start md:gap-x-10 lg:gap-x-14"
      >
        {/* The pictures: the start column on a wide screen, first on a phone */}
        <div className="flex flex-col gap-3 md:row-span-3">
          <div
            className={cn(
              'overflow-hidden rounded-card border border-line bg-surface',
              main ? 'aspect-[4/5]' : 'aspect-[4/3] md:aspect-square',
            )}
          >
            {main ? (
              <img src={main.url} alt={product.name} className="size-full object-contain" />
            ) : (
              <NoPicture large />
            )}
          </div>
          {images.length > 1 ? (
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  aria-label={`الصورة ${i + 1}`}
                  aria-pressed={img === main}
                  onClick={() => setShown(i)}
                  className={cn(
                    'size-16 shrink-0 overflow-hidden rounded-small border bg-surface transition-[border-color,box-shadow] duration-120 ease-standard',
                    img === main
                      ? 'border-brand ring-1 ring-brand'
                      : 'border-line hover:border-line-control/50',
                  )}
                >
                  <img src={img.thumbUrl} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* The name, the price and the choices */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            {product.offer ? <OfferTag className="w-fit max-w-full">{product.offer}</OfferTag> : null}
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">{product.name}</h1>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Money
                minor={price}
                currency={product.currency}
                className="text-2xl font-bold text-ink"
                unitClassName="text-base font-semibold text-ink-subtle"
              />
              {was ? (
                <s aria-label="السعر قبل التنزيل" className="text-base text-ink-subtle">
                  <Money minor={was} currency={product.currency} />
                </s>
              ) : null}
            </p>
          </div>
          {product.options.length > 0 ? (
            <div className="flex flex-col gap-5 border-t border-line pt-6">
              {product.options.map((option) => (
                <div
                  key={option.name}
                  role="group"
                  aria-label={option.name}
                  className="flex flex-col gap-2.5"
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {option.name}
                    {chosen[option.name] ? (
                      <span className="font-normal text-ink-muted">· {chosen[option.name]}</span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {option.values.map((value) => {
                      const can = canPick(product, chosen, option.name, value);
                      const on = chosen[option.name] === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={on}
                          disabled={!can}
                          onClick={() => {
                            setChosen((c) => ({ ...c, [option.name]: value }));
                            setShown(0);
                            setAdded(false);
                          }}
                          className={cn(
                            CONTROL_HEIGHT[density],
                            'min-w-12 rounded-small border px-4 text-[0.9375rem] font-semibold transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard select-none',
                            !can
                              ? cn(
                                  'cursor-not-allowed border-dashed text-ink-subtle line-through',
                                  on ? 'border-brand' : 'border-line-control/50',
                                )
                              : on
                                ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand'
                                : 'border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
                          )}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {variant && !variant.available ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-danger-ink">
              <AlertCircleIcon size={16} />
              هذه القطعة نفدت.
            </p>
          ) : null}
        </div>

        {/* The quantity and «أضف إلى السلة»: kept in reach at the foot of a phone's screen */}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-line bg-surface/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          {added ? (
            <Banner
              tone="success"
              action={
                <>
                  <Button size="sm" onClick={() => navigate(`${base}/cart`)}>
                    السلة
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(base)}>
                    تابع التسوق
                  </Button>
                </>
              }
            >
              أُضيفت إلى السلة.
            </Banner>
          ) : null}
          <div className="flex items-center gap-3">
            <div role="group" aria-label="الكمية" className="flex shrink-0 items-center gap-1">
              <IconButton
                variant="secondary"
                size="lg"
                label="أنقص"
                icon={<RemoveIcon />}
                disabled={qty <= 1}
                onClick={() => setQty((q) => q - 1)}
              />
              <output className="num min-w-9 text-center text-lg font-bold">{qty}</output>
              <IconButton
                variant="secondary"
                size="lg"
                label="زد"
                icon={<AddIcon />}
                disabled={qty >= MAX_QTY}
                onClick={() => setQty((q) => q + 1)}
              />
            </div>
            <Button
              size="lg"
              className="flex-1"
              icon={variant ? <CartIcon /> : undefined}
              disabled={!variant || !variant.available}
              onClick={() => {
                if (!variant) return;
                cart.add({
                  variantId: variant.id,
                  productId: product.id,
                  name: product.name,
                  label: variant.label,
                  imageUrl: product.images[0]?.thumbUrl ?? null,
                  priceMinor: variant.priceMinor,
                  qty,
                });
                setAdded(true);
              }}
            >
              {variant ? 'أضف إلى السلة' : `اختر ${product.options.find((o) => !chosen[o.name])?.name ?? ''}`}
            </Button>
          </div>
        </div>

        {home.store.whatsapp ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <SendIcon size={16} className="text-ink-subtle" />
            عندك سؤال؟
            <TextLink
              href={`https://wa.me/${home.store.whatsapp}?text=${encodeURIComponent(`مرحباً، أسأل عن ${product.name}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              اسأل المحل على واتساب
            </TextLink>
          </p>
        ) : null}
      </article>
    </>
  );
}

function CartView({ home, slug, base, cart }: { home: ShopHome; slug: string; base: string; cart: Cart }) {
  const { store } = home;
  const density = useDensity();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>(store.delivery ? 'delivery' : 'pickup');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  // The courier's fee: the picked area's when the store charges by area, else the flat one
  const byArea = store.deliveryAreas.length > 0;
  const fee =
    fulfilment !== 'delivery'
      ? 0
      : byArea
        ? (store.deliveryAreas.find((a) => a.name === area)?.feeMinor ?? 0)
        : store.deliveryFeeMinor;
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<ShopOrderPlaced | null>(null);
  const [challenge, setChallenge] = useState<ShopCodeSent | null>(null);
  const [code, setCode] = useState('');
  const byCode = store.orderMode === 'shop';

  if (placed) {
    return (
      <section
        aria-label="وصل طلبك"
        className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 rounded-panel border border-line bg-surface p-6 text-center shadow-e2 motion-safe:animate-rise sm:p-8"
      >
        <IconChip size="lg" tone="success">
          <CheckCircleIcon size={24} />
        </IconChip>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold">حُفظ طلبك</h1>
          <p className="text-ink-muted">
            {placed.whatsappUrl
              ? 'أرسله للمحل على واتساب ليؤكده لك.'
              : 'وصل طلبك إلى المحل، وسيؤكده لك على رقمك.'}
          </p>
        </div>
        <dl className="w-full divide-y divide-line rounded-card border border-line text-start text-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-ink-muted">رقم الطلب</dt>
            <dd>
              <bdi dir="ltr" className="num font-bold">
                {placed.number}
              </bdi>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-ink-muted">المجموع</dt>
            <dd>
              <Money minor={placed.totalMinor} currency={placed.currency} className="font-bold" />
            </dd>
          </div>
          {placed.deliveryFeeMinor > 0 ? (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-ink-muted">أجرة التوصيل (للمندوب)</dt>
              <dd>
                <Money minor={placed.deliveryFeeMinor} currency={placed.currency} />
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="flex w-full flex-col gap-3">
          {placed.whatsappUrl ? (
            <a href={placed.whatsappUrl} className={linkButton('primary', density)}>
              <SendIcon />
              أرسل الطلب على واتساب
            </a>
          ) : null}
          <Link
            to={placed.trackPath}
            className={linkButton(placed.whatsappUrl ? 'secondary' : 'primary', density)}
          >
            تابع طلبك
          </Link>
        </div>
        <TextLink as={Link} to={base} className="text-sm">
          عد إلى المتجر
        </TextLink>
      </section>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        icon={CartIcon}
        title="السلة فارغة"
        description="اختر ما يعجبك من المتجر وأضفه هنا."
        className="bg-surface"
        action={
          <Link to={base} className={linkButton('primary', density)}>
            إلى المتجر
          </Link>
        }
      />
    );
  }

  /** «من المتجر مباشرة»: a code to the phone first, typed back with the order */
  async function askCode() {
    setSending(true);
    setError(null);
    setFields({});
    try {
      setChallenge(
        await apiFetch<ShopCodeSent>(`/v1/shop/${encodeURIComponent(slug)}/orders/code`, {
          method: 'POST',
          body: { phone },
        }),
      );
      setCode('');
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSending(false);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    setFields({});
    try {
      const done = await apiFetch<ShopOrderPlaced>(`/v1/shop/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        body: {
          name,
          phone,
          fulfilment,
          address: fulfilment === 'delivery' ? address : null,
          area: fulfilment === 'delivery' && byArea ? area || null : null,
          note: note || null,
          lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
          ...(byCode && challenge ? { challengeId: challenge.challengeId, code } : {}),
        },
      });
      cart.clear();
      setPlaced(done);
      if (done.whatsappUrl) openWhatsApp(done.whatsappUrl);
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSending(false);
    }
  }

  const subtotal = cartTotal(cart.lines);

  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-8">
      {/* The cart: first on a phone; on a wide screen the summary at the end, kept in view */}
      <section
        aria-label="السلة"
        className="flex flex-col rounded-card border border-line bg-surface shadow-e1 md:sticky md:top-24 md:col-start-2 md:row-start-1"
      >
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5 sm:px-6">
          <h1 className="text-xl font-bold">السلة</h1>
          <p className="text-sm text-ink-muted">{counted(cartCount(cart.lines), PIECES)}</p>
        </div>
        <ul className="flex flex-col divide-y divide-line px-5 sm:px-6">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="flex items-start gap-3 py-4">
              <span className="size-14 shrink-0 overflow-hidden rounded-small border border-line">
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center bg-brand-soft text-brand">
                    <ProductsIcon size={20} />
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{line.name}</span>
                  {line.label ? <span className="text-sm text-ink-muted">{line.label}</span> : null}
                </span>
                <span className="flex items-center justify-between gap-3">
                  <Money
                    minor={line.priceMinor * line.qty}
                    currency={store.currency}
                    className="text-sm font-bold"
                  />
                  <span
                    className="flex shrink-0 items-center gap-1"
                    role="group"
                    aria-label={`كمية ${line.name} ${line.label ?? ''}`.trim()}
                  >
                    <IconButton
                      size="xs"
                      variant="secondary"
                      label="أنقص"
                      icon={<RemoveIcon size={16} />}
                      onClick={() => cart.setQty(line.variantId, line.qty - 1)}
                    />
                    <output className="num min-w-7 text-center font-bold">{line.qty}</output>
                    <IconButton
                      size="xs"
                      variant="secondary"
                      label="زد"
                      icon={<AddIcon size={16} />}
                      disabled={line.qty >= MAX_QTY}
                      onClick={() => cart.setQty(line.variantId, line.qty + 1)}
                    />
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-b-card border-t border-line bg-surface-total px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <span className={fee > 0 ? 'text-ink-muted' : 'font-semibold'}>المجموع</span>
            <Money
              minor={subtotal}
              currency={store.currency}
              className={fee > 0 ? 'font-semibold' : 'text-xl font-bold'}
            />
          </div>
          {fee > 0 ? (
            <>
              <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
                <span>أجرة التوصيل (للمندوب)</span>
                <Money minor={fee} currency={store.currency} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                <span className="font-semibold">الإجمالي</span>
                <Money minor={subtotal + fee} currency={store.currency} className="text-xl font-bold" />
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section
        aria-label="إتمام الطلب"
        className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6 md:col-start-1 md:row-start-1"
      >
        <h2 className="text-xl font-bold">بياناتك</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="الاسم"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 80))}
            error={fields.name}
          />
          <TextField
            label="رقم الجوال"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.slice(0, 20));
              // A code belongs to its number: a new number asks again
              setChallenge(null);
            }}
            error={fields.phone}
          />
        </div>
        {store.delivery && store.pickup ? (
          <div className="flex flex-col gap-1.5">
            <p aria-hidden="true" className="text-sm font-semibold text-ink-muted">
              الاستلام
            </p>
            <div role="group" aria-label="الاستلام" className="grid grid-cols-2 gap-3">
              {(['delivery', 'pickup'] as const).map((f) => {
                const on = fulfilment === f;
                const WayIcon = f === 'delivery' ? TruckIcon : StoreIcon;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFulfilment(f)}
                    className={cn(
                      CONTROL_HEIGHT[density],
                      // On a phone the picture stands over the words, so «استلام من المحل» never wraps.
                      'flex flex-col items-center justify-center gap-1 rounded-control border px-3 py-2 text-[0.9375rem] font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-120 ease-standard select-none sm:flex-row sm:gap-2.5 sm:py-0',
                      on
                        ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand'
                        : 'border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
                    )}
                  >
                    <WayIcon className={on ? 'text-brand-ink' : 'text-ink-subtle'} />
                    {f === 'delivery' ? 'توصيل' : 'استلام من المحل'}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            {store.delivery ? <TruckIcon size={16} /> : <StoreIcon size={16} />}
            {store.delivery ? 'التوصيل إلى عنوانك' : 'الاستلام من المحل'}
          </p>
        )}
        {fulfilment === 'delivery' && byArea ? (
          <Select
            label="منطقة التوصيل"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            error={fields.area}
          >
            <option value="">اختر منطقتك</option>
            {store.deliveryAreas.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </Select>
        ) : null}
        {fulfilment === 'delivery' ? (
          <TextField
            label="العنوان"
            value={address}
            onChange={(e) => setAddress(e.target.value.slice(0, 300))}
            error={fields.address}
          />
        ) : null}
        <TextField
          label="ملاحظة (اختياري)"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
        />
        {byCode && challenge ? (
          <TextField
            label="رمز التأكيد"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(digitsOf(e.target.value).slice(0, 6))}
            error={fields.code}
            hint={
              challenge.testCode
                ? `وضع التجربة: الرمز ${challenge.testCode}`
                : 'أرسلنا رمزاً من 6 أرقام إلى جوالك.'
            }
          />
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          {byCode && !challenge ? (
            <Button
              size="lg"
              fullWidth
              loading={sending}
              disabled={!name.trim() || !phone.trim()}
              onClick={() => void askCode()}
            >
              أرسل رمز التأكيد
            </Button>
          ) : (
            <Button
              size="lg"
              fullWidth
              icon={!byCode && store.whatsapp ? <SendIcon /> : undefined}
              loading={sending}
              disabled={!name.trim() || !phone.trim() || (byCode && code.length < 6)}
              onClick={() => void send()}
            >
              {byCode ? 'أكّد الطلب' : store.whatsapp ? 'اطلب عبر واتساب' : 'أرسل الطلب'}
            </Button>
          )}
          {byCode && challenge ? (
            <Button variant="ghost" fullWidth disabled={sending} onClick={() => void askCode()}>
              لم يصلك؟ أرسل رمزاً جديداً
            </Button>
          ) : null}
          <p className="mt-1 flex items-start gap-2 text-xs text-ink-muted">
            <InfoIcon size={16} className="shrink-0 text-ink-subtle" />
            {byCode
              ? 'نرسل رمزاً إلى جوالك لنتأكد أن الرقم لك، ثم يصل طلبك إلى المحل مباشرة.'
              : 'يُحفظ طلبك عند المحل، ثم يفتح واتساب برسالة جاهزة فيها القطع والمجموع. اضغط «إرسال» هناك.'}
          </p>
        </div>
      </section>
    </div>
  );
}

const TRACK_STEPS: Record<ShopOrderTrack['status'], { title: string; text: string }> = {
  pending: { title: 'بانتظار تأكيد المحل', text: 'وصل طلبك، وسيراجعه المحل قريباً.' },
  accepted: { title: 'أكّد المحل طلبك', text: 'قطعك محجوزة لك ويجري تجهيزها.' },
  done: { title: 'تمّ التسليم', text: 'شكراً لك! نتمنى أن تعجبك قطعك.' },
  rejected: { title: 'اعتذر المحل عن الطلب', text: 'تواصل مع المحل لتعرف السبب أو اطلب قطعاً أخرى.' },
};

/** The way of an order, as the customer follows it: received, confirmed, handed over. */
const TRACK_PATH: readonly { status: ShopOrderTrack['status']; label: string }[] = [
  { status: 'pending', label: 'وصل الطلب' },
  { status: 'accepted', label: 'أكّده المحل' },
  { status: 'done', label: 'تمّ التسليم' },
];

/** The customer's page for one order, by the unguessable link given when it was placed. */
function TrackView({ slug, base }: { slug: string; base: string }) {
  const { token = '' } = useParams();
  const [order, setOrder] = useState<ShopOrderTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<ShopOrderTrack>(`/v1/shop/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}`)
      .then((o) => alive && setOrder(o))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [slug, token]);

  if (error) {
    return <EmptyState icon={StoreIcon} title="الطلب غير موجود" description={error} className="bg-surface" />;
  }
  if (!order) {
    return (
      <div
        aria-busy="true"
        className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
      >
        <p className="sr-only">لحظة…</p>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-20 w-full" />
        <SkeletonText lines={3} />
      </div>
    );
  }
  const step = TRACK_STEPS[order.status];
  const rejected = order.status === 'rejected';
  const reached = TRACK_PATH.findIndex((s) => s.status === order.status);
  const StepIcon = rejected ? AlertCircleIcon : order.status === 'pending' ? ClockIcon : CheckCircleIcon;
  return (
    <section
      aria-label="طلبك"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold">
          طلبك{' '}
          <bdi dir="ltr" className="num">
            {order.number}
          </bdi>
        </h1>
        <Badge>{order.fulfilment === 'delivery' ? 'توصيل' : 'استلام من المحل'}</Badge>
      </div>
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-card border p-4',
          rejected
            ? 'border-danger/20 bg-danger-soft text-danger-ink'
            : 'border-brand/20 bg-brand-soft text-brand-ink',
        )}
      >
        <StepIcon className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <p className="font-bold">{step.title}</p>
          <p className="text-sm">{step.text}</p>
        </div>
      </div>
      {!rejected ? (
        <ol aria-label="مراحل الطلب" className="grid grid-cols-3 gap-2">
          {TRACK_PATH.map((s, i) => (
            <li key={s.status} className="flex flex-col gap-2">
              <span
                aria-hidden="true"
                className={cn('h-1.5 rounded-full', i <= reached ? 'bg-brand' : 'bg-surface-muted')}
              />
              <span className={cn('text-xs font-semibold', i <= reached ? 'text-ink' : 'text-ink-subtle')}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {order.lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-3">
            <span className="min-w-0">
              <span className="font-semibold">{l.name}</span>
              {l.label ? <span className="text-ink-muted"> · {l.label}</span> : null}
              <span className="num text-ink-muted"> × {l.qty}</span>
            </span>
            <Money minor={l.totalMinor} currency={order.currency} className="shrink-0" />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">المجموع</span>
          <Money minor={order.totalMinor} currency={order.currency} className="text-lg font-bold" />
        </div>
        {order.deliveryFeeMinor > 0 ? (
          <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
            <span>أجرة التوصيل (للمندوب)</span>
            <Money minor={order.deliveryFeeMinor} currency={order.currency} />
          </div>
        ) : null}
      </div>
      <TextLink as={Link} to={base} className="w-fit text-sm">
        عد إلى المتجر
      </TextLink>
    </section>
  );
}
