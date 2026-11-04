import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import type { ShopCodeSent, ShopHome, ShopOrderPlaced, ShopOrderTrack, ShopProduct } from '@serva/core';
import {
  Alert,
  Button,
  CartIcon,
  cn,
  EmptyState,
  FullScreenLoader,
  Money,
  Select,
  StoreIcon,
  TextField,
} from '@serva/ui';
import { ApiError, apiFetch, errorMessage } from '../lib/api';
import { canPick, cartCount, cartTotal, MAX_QTY, useShopCart, variantFor } from './cart';
import { openWhatsApp } from './open';

/**
 * The store's online shop (26 › المتجر الإلكتروني): its goods with their pictures, sizes and
 * colours on the shelf, a cart kept on the customer's phone, and the order: «اطلب عبر واتساب»
 * (saved for the store, then WhatsApp opens on the store's number with it written out) or, when the
 * store takes orders in the shop itself, a code to the customer's phone confirms it. Each order has
 * its page for the customer to follow. No sign-in, no app to install; made for a phone first.
 */
export function ShopApp() {
  const { slug = '' } = useParams();
  const [home, setHome] = useState<ShopHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cart = useShopCart(slug);

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
      <main dir="rtl" className="mx-auto max-w-lg p-6">
        <title>المتجر · Serva</title>
        <EmptyState icon={StoreIcon} title="المتجر غير متاح" description={error} />
      </main>
    );
  }
  if (!home) return <FullScreenLoader />;
  const base = `/shop/${slug}`;
  const count = cartCount(cart.lines);

  return (
    <div dir="rtl" className="min-h-screen bg-surface-muted text-ink">
      <title>{`${home.store.name} · المتجر`}</title>
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Link to={base} className="flex-1 truncate text-lg font-bold">
          {home.store.name}
        </Link>
        <Link
          to={`${base}/cart`}
          aria-label={`السلة، ${count} قطعة`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 font-semibold text-on-brand"
        >
          السلة
          <span className="num rounded-full bg-surface px-2 text-sm text-ink">{count}</span>
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        <Routes>
          <Route index element={<Catalogue home={home} base={base} />} />
          <Route path="p/:id" element={<ProductView home={home} slug={slug} base={base} cart={cart} />} />
          <Route path="cart" element={<CartView home={home} slug={slug} base={base} cart={cart} />} />
          <Route path="o/:token" element={<TrackView slug={slug} base={base} />} />
        </Routes>
      </main>
    </div>
  );
}

type Cart = ReturnType<typeof useShopCart>;

const digitsOf = (text: string) => [...text].filter((ch) => ch >= '0' && ch <= '9').join('');

function Catalogue({ home, base }: { home: ShopHome; base: string }) {
  const [category, setCategory] = useState<string | null>(null);
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
  const shown = category ? home.products.filter((p) => rootOf(p.categoryId) === category) : home.products;
  return (
    <>
      {home.store.note ? <p className="rounded-control bg-surface p-3 text-sm">{home.store.note}</p> : null}
      {tops.length > 0 ? (
        <div role="group" aria-label="الأقسام" className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: null, name: 'الكل' }, ...tops].map((c) => (
            <button
              key={c.id ?? 'all'}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                'min-h-11 shrink-0 rounded-full border px-4 font-semibold',
                category === c.id ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState icon={StoreIcon} title="لا بضاعة هنا الآن" description="جرّب قسماً آخر، أو عد لاحقاً." />
      ) : (
        <ul aria-label="البضاعة" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                to={`${base}/p/${p.id}`}
                className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
                ) : (
                  <div className="grid aspect-[3/4] w-full place-items-center bg-surface-muted text-ink-muted">
                    بلا صورة
                  </div>
                )}
                <span className="flex flex-1 flex-col gap-1 p-2">
                  {p.offer ? (
                    <span className="w-fit rounded-full bg-danger-soft px-2 text-xs font-bold text-danger-ink">
                      {p.offer}
                    </span>
                  ) : null}
                  <span className="line-clamp-2 font-semibold">{p.name}</span>
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span>
                      {p.maxPriceMinor > p.priceMinor ? 'من ' : ''}
                      <Money minor={p.priceMinor} currency={p.currency} className="font-bold" />
                    </span>
                    {p.wasPriceMinor ? (
                      <s aria-label="السعر قبل التنزيل" className="text-xs text-ink-muted">
                        <Money minor={p.wasPriceMinor} currency={p.currency} />
                      </s>
                    ) : null}
                  </span>
                  {!p.available ? <span className="text-xs font-semibold text-danger-ink">نفد</span> : null}
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

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!product) return <p className="text-ink-muted">لحظة…</p>;
  const variant = variantFor(product, chosen);
  // The picture of a chosen colour first
  const images = product.images;
  const matching = images.findIndex((i) => i.optionValue && Object.values(chosen).includes(i.optionValue));
  const main = images[matching >= 0 && shown === 0 ? matching : shown] ?? images[0];
  const cheapest = product.variants.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
  const price = variant?.priceMinor ?? cheapest.priceMinor;
  const was = (variant ?? cheapest).wasPriceMinor;

  return (
    <article aria-label={product.name} className="flex flex-col gap-4 md:grid md:grid-cols-2">
      <div className="flex flex-col gap-2">
        {main ? (
          <img src={main.url} alt={product.name} className="w-full rounded-card bg-surface object-contain" />
        ) : (
          <div className="grid aspect-square place-items-center rounded-card bg-surface text-ink-muted">
            بلا صورة
          </div>
        )}
        {images.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                aria-label={`الصورة ${i + 1}`}
                aria-pressed={img === main}
                onClick={() => setShown(i)}
                className={cn(
                  'size-16 shrink-0 overflow-hidden rounded-control border-2',
                  img === main ? 'border-brand' : 'border-line',
                )}
              >
                <img src={img.thumbUrl} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{product.name}</h1>
        {product.offer ? (
          <span className="w-fit rounded-full bg-danger-soft px-3 py-1 text-sm font-bold text-danger-ink">
            {product.offer}
          </span>
        ) : null}
        <span className="flex flex-wrap items-baseline gap-3">
          <Money minor={price} currency={product.currency} className="text-2xl font-bold" />
          {was ? (
            <s aria-label="السعر قبل التنزيل" className="text-lg text-ink-muted">
              <Money minor={was} currency={product.currency} />
            </s>
          ) : null}
        </span>
        {product.options.map((option) => (
          <div key={option.name} role="group" aria-label={option.name} className="flex flex-col gap-2">
            <span className="font-semibold">{option.name}</span>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const can = canPick(product, chosen, option.name, value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chosen[option.name] === value}
                    disabled={!can}
                    onClick={() => {
                      setChosen((c) => ({ ...c, [option.name]: value }));
                      setShown(0);
                      setAdded(false);
                    }}
                    className={cn(
                      'min-h-11 min-w-11 rounded-control border-2 px-3 font-semibold',
                      chosen[option.name] === value
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface',
                      !can && 'opacity-40 line-through',
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3" role="group" aria-label="الكمية">
          <Button
            variant="secondary"
            aria-label="أنقص"
            disabled={qty <= 1}
            onClick={() => setQty((q) => q - 1)}
          >
            −
          </Button>
          <output className="num min-w-8 text-center text-lg font-bold">{qty}</output>
          <Button
            variant="secondary"
            aria-label="زد"
            disabled={qty >= MAX_QTY}
            onClick={() => setQty((q) => q + 1)}
          >
            +
          </Button>
        </div>
        {variant && !variant.available ? (
          <p className="font-semibold text-danger-ink">هذه القطعة نفدت.</p>
        ) : null}
        <Button
          size="lg"
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
        {added ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-control bg-success-soft p-3 text-success-ink"
          >
            <span className="flex-1 font-semibold">أُضيفت إلى السلة.</span>
            <Button size="sm" onClick={() => navigate(`${base}/cart`)}>
              السلة
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate(base)}>
              تابع التسوق
            </Button>
          </div>
        ) : null}
        {home.store.whatsapp ? (
          <a
            className="text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
            href={`https://wa.me/${home.store.whatsapp}?text=${encodeURIComponent(`مرحباً، أسأل عن ${product.name}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            اسأل المحل على واتساب
          </a>
        ) : null}
      </div>
    </article>
  );
}

function CartView({ home, slug, base, cart }: { home: ShopHome; slug: string; base: string; cart: Cart }) {
  const { store } = home;
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
        className="flex flex-col items-center gap-4 rounded-card bg-surface p-6 text-center"
      >
        <h1 className="text-2xl font-bold">حُفظ طلبك</h1>
        <p>
          رقم الطلب{' '}
          <bdi dir="ltr" className="num font-bold">
            {placed.number}
          </bdi>{' '}
          · <Money minor={placed.totalMinor} currency={placed.currency} className="font-bold" />
          {placed.deliveryFeeMinor > 0 ? (
            <>
              {' '}
              + أجرة التوصيل <Money minor={placed.deliveryFeeMinor} currency={placed.currency} />
            </>
          ) : null}
        </p>
        {placed.whatsappUrl ? (
          <>
            <p className="text-ink-muted">أرسله للمحل على واتساب ليؤكده لك.</p>
            <a
              href={placed.whatsappUrl}
              className="inline-flex min-h-12 items-center rounded-full bg-brand px-6 font-bold text-on-brand"
            >
              أرسل الطلب على واتساب
            </a>
          </>
        ) : (
          <p className="text-ink-muted">وصل طلبك إلى المحل، وسيؤكده لك على رقمك.</p>
        )}
        <Link
          to={placed.trackPath}
          className="inline-flex min-h-11 items-center rounded-full border-2 border-brand px-6 font-semibold text-brand-ink"
        >
          تابع طلبك
        </Link>
        <Link to={base} className="text-sm font-semibold text-brand-ink">
          عد إلى المتجر
        </Link>
      </section>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        icon={CartIcon}
        title="السلة فارغة"
        description="اختر ما يعجبك من المتجر وأضفه هنا."
        action={
          <Link to={base} className="font-semibold text-brand-ink">
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

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
      <section aria-label="السلة" className="flex flex-col gap-3 rounded-card bg-surface p-4">
        <h1 className="text-xl font-bold">السلة</h1>
        <ul className="flex flex-col divide-y divide-line">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="flex items-center gap-3 py-3">
              {line.imageUrl ? (
                <img src={line.imageUrl} alt="" className="size-16 rounded-control object-cover" />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{line.name}</span>
                {line.label ? <span className="text-sm text-ink-muted">{line.label}</span> : null}
                <Money minor={line.priceMinor * line.qty} currency={store.currency} className="font-bold" />
              </span>
              <span
                className="flex items-center gap-1"
                role="group"
                aria-label={`كمية ${line.name} ${line.label ?? ''}`.trim()}
              >
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="أنقص"
                  onClick={() => cart.setQty(line.variantId, line.qty - 1)}
                >
                  −
                </Button>
                <output className="num min-w-6 text-center font-bold">{line.qty}</output>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="زد"
                  disabled={line.qty >= MAX_QTY}
                  onClick={() => cart.setQty(line.variantId, line.qty + 1)}
                >
                  +
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="font-semibold">المجموع</span>
          <Money minor={cartTotal(cart.lines)} currency={store.currency} className="text-xl font-bold" />
        </div>
        {fee > 0 ? (
          <>
            <div className="flex items-center justify-between text-sm text-ink-muted">
              <span>أجرة التوصيل (للمندوب)</span>
              <Money minor={fee} currency={store.currency} />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold">الإجمالي</span>
              <Money minor={cartTotal(cart.lines) + fee} currency={store.currency} className="font-bold" />
            </div>
          </>
        ) : null}
      </section>
      <section aria-label="إتمام الطلب" className="flex flex-col gap-3 rounded-card bg-surface p-4">
        <h2 className="text-xl font-bold">بياناتك</h2>
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
        {store.delivery && store.pickup ? (
          <div role="group" aria-label="الاستلام" className="grid grid-cols-2 gap-2">
            {(['delivery', 'pickup'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={fulfilment === f}
                onClick={() => setFulfilment(f)}
                className={cn(
                  'min-h-11 rounded-control border-2 font-semibold',
                  fulfilment === f ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line',
                )}
              >
                {f === 'delivery' ? 'توصيل' : 'استلام من المحل'}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
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
        {byCode && !challenge ? (
          <Button
            size="lg"
            loading={sending}
            disabled={!name.trim() || !phone.trim()}
            onClick={() => void askCode()}
          >
            أرسل رمز التأكيد
          </Button>
        ) : (
          <Button
            size="lg"
            loading={sending}
            disabled={!name.trim() || !phone.trim() || (byCode && code.length < 6)}
            onClick={() => void send()}
          >
            {byCode ? 'أكّد الطلب' : store.whatsapp ? 'اطلب عبر واتساب' : 'أرسل الطلب'}
          </Button>
        )}
        {byCode && challenge ? (
          <Button variant="ghost" disabled={sending} onClick={() => void askCode()}>
            لم يصلك؟ أرسل رمزاً جديداً
          </Button>
        ) : null}
        <p className="text-xs text-ink-muted">
          {byCode
            ? 'نرسل رمزاً إلى جوالك لنتأكد أن الرقم لك، ثم يصل طلبك إلى المحل مباشرة.'
            : 'يُحفظ طلبك عند المحل، ثم يفتح واتساب برسالة جاهزة فيها القطع والمجموع. اضغط «إرسال» هناك.'}
        </p>
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

  if (error) return <EmptyState icon={StoreIcon} title="الطلب غير موجود" description={error} />;
  if (!order) return <FullScreenLoader />;
  const step = TRACK_STEPS[order.status];
  return (
    <section aria-label="طلبك" className="flex flex-col gap-4 rounded-card bg-surface p-5">
      <h1 className="text-xl font-bold">
        طلبك{' '}
        <bdi dir="ltr" className="num">
          {order.number}
        </bdi>
      </h1>
      <div
        role="status"
        className={cn(
          'rounded-control p-4',
          order.status === 'rejected' ? 'bg-danger-soft text-danger-ink' : 'bg-brand-soft text-brand-ink',
        )}
      >
        <p className="font-bold">{step.title}</p>
        <p className="text-sm">{step.text}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {order.lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2">
            <span>
              {l.name}
              {l.label ? <span className="text-ink-muted"> · {l.label}</span> : null}
              <span className="num text-ink-muted"> × {l.qty}</span>
            </span>
            <Money minor={l.totalMinor} currency={order.currency} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="font-semibold">
          المجموع · {order.fulfilment === 'delivery' ? 'توصيل' : 'استلام من المحل'}
        </span>
        <Money minor={order.totalMinor} currency={order.currency} className="text-lg font-bold" />
      </div>
      {order.deliveryFeeMinor > 0 ? (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>أجرة التوصيل (للمندوب)</span>
          <Money minor={order.deliveryFeeMinor} currency={order.currency} />
        </div>
      ) : null}
      <Link to={base} className="text-sm font-semibold text-brand-ink">
        عد إلى المتجر
      </Link>
    </section>
  );
}
