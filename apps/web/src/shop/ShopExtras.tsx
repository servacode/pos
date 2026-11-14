import { useState, type CSSProperties } from 'react';
import type { ShopAccent, ShopCoupon, ShopProduct, ShopStore } from '@serva/core';
import { Alert, Button, IconChip, initialsOf, TextField } from '@serva/ui';
import { ApiError, apiFetch, errorMessage } from '../lib/api';

/**
 * The pieces the shop grew (26 › المتجر الإلكتروني): the store's look (its logo, cover, tagline and
 * accent), the product's description and size guide, «أبلغني عند التوفر» and the cart's coupon box.
 * Everything the store wrote is shown as text: React escapes it, and line breaks are kept by CSS.
 */

/**
 * The accent: the shop's buttons and selections take one of the identity's own colour families, by
 * pointing the brand tokens at its tokens (each already has its light and dark values and its text
 * colour), so contrast holds in both modes. «emerald» is the brand itself: nothing to change.
 */
const FAMILIES: Record<Exclude<ShopAccent, 'emerald'>, string> = { teal: 'accent', blue: 'info' };

export function accentStyle(accent: ShopAccent | undefined): CSSProperties | undefined {
  const family = accent && accent !== 'emerald' ? FAMILIES[accent] : undefined;
  if (!family) return undefined;
  return {
    '--color-brand': `var(--color-${family})`,
    '--color-brand-hover': `var(--color-${family}-ink)`,
    '--color-on-brand': 'var(--color-on-accent)',
    '--color-brand-soft': `var(--color-${family}-soft)`,
    '--color-brand-ink': `var(--color-${family}-ink)`,
    '--color-ring': `var(--color-${family})`,
  } as CSSProperties;
}

/** The store's logo, or its monogram when it has none */
export function StoreMark({ store }: { store: Pick<ShopStore, 'name' | 'logoUrl'> }) {
  if (store.logoUrl) {
    return <img src={store.logoUrl} alt="" className="size-10 shrink-0 rounded-control object-cover" />;
  }
  return (
    <IconChip>
      <span className="text-sm font-bold">{initialsOf(store.name)}</span>
    </IconChip>
  );
}

/** The cover banner under the header; nothing without one */
export function CoverBanner({ store }: { store: Pick<ShopStore, 'name' | 'coverUrl'> }) {
  if (!store.coverUrl) return null;
  return (
    <div className="border-b border-line bg-surface-muted">
      <img
        src={store.coverUrl}
        alt=""
        className="mx-auto h-32 w-full max-w-6xl object-cover sm:h-44 lg:h-56"
        loading="eager"
      />
    </div>
  );
}

/** The description and the size guide the store wrote for the page, as plain text */
export function ProductNotes({ product }: { product: Pick<ShopProduct, 'description' | 'sizeGuide'> }) {
  if (!product.description && !product.sizeGuide) return null;
  return (
    <div className="flex flex-col gap-5 border-t border-line pt-6 md:col-span-1">
      {product.description ? (
        <section aria-label="وصف المنتج" className="flex flex-col gap-1.5">
          <h2 className="text-base font-bold text-ink">الوصف</h2>
          <p className="text-[0.9375rem] leading-7 whitespace-pre-line text-ink-muted">
            {product.description}
          </p>
        </section>
      ) : null}
      {product.sizeGuide ? (
        <section aria-label="دليل المقاسات" className="flex flex-col gap-1.5">
          <h2 className="text-base font-bold text-ink">دليل المقاسات</h2>
          <p className="text-[0.9375rem] leading-7 whitespace-pre-line text-ink-muted">{product.sizeGuide}</p>
        </section>
      ) : null}
    </div>
  );
}

/** «أبلغني عند التوفر»: a phone left on a piece that ran out */
export function NotifyMe({
  slug,
  productId,
  variantId,
}: {
  slug: string;
  productId: string;
  variantId: string;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function send() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await apiFetch(
        `/v1/shop/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}/notify`,
        { method: 'POST', body: { variantId, phone } },
      );
      setDone(variantId);
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setBusy(false);
    }
  }

  if (done === variantId) {
    return <Alert tone="success">سجّلنا رقمك. يراسلك المحل عندما تتوفر هذه القطعة.</Alert>;
  }
  return (
    <form
      aria-label="أبلغني عند التوفر"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface-muted/60 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="text-sm text-ink-muted">اترك رقمك ويراسلك المحل عندما تعود هذه القطعة.</p>
      <TextField
        label="رقم الجوال"
        dir="ltr"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value.slice(0, 20))}
        error={fields.phone}
        hint="مثال: 0944555666"
      />
      {error && !fields.phone ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" variant="secondary" loading={busy} disabled={!phone.trim()}>
        أبلغني عند التوفر
      </Button>
    </form>
  );
}

/** «كود الخصم» in the cart: checked by the server before the order, applied when it is sold */
export function CouponBox({
  slug,
  applied,
  onApplied,
  onClear,
}: {
  slug: string;
  applied: { code: string; coupon: ShopCoupon } | null;
  onApplied: (value: { code: string; coupon: ShopCoupon }) => void;
  onClear: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    const typed = code.trim();
    if (!typed) return;
    setBusy(true);
    setError(null);
    try {
      const coupon = await apiFetch<ShopCoupon>(
        `/v1/shop/${encodeURIComponent(slug)}/coupon?code=${encodeURIComponent(typed)}`,
      );
      onApplied({ code: typed, coupon });
      setCode('');
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.coupon ?? errorMessage(e)) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-brand-soft px-3 py-2 text-sm text-brand-ink">
        <span>
          كود الخصم{' '}
          <bdi dir="ltr" className="num font-bold">
            {applied.code.toUpperCase()}
          </bdi>
          : {applied.coupon.name}
        </span>
        <Button size="sm" variant="ghost" onClick={onClear}>
          أزل الكود
        </Button>
      </div>
    );
  }
  return (
    <form
      aria-label="كود الخصم"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void apply();
      }}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label="كود الخصم (اختياري)"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 20))}
            error={error ?? undefined}
          />
        </div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!code.trim()}>
          طبّق
        </Button>
      </div>
    </form>
  );
}
