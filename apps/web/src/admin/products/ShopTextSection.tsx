import { useCallback, useEffect, useId, useState } from 'react';
import type { ProductTexts, StockAlert } from '@serva/core';
import { Alert, Badge, Button, CheckIcon, SendIcon, StoreIcon } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { apiFetch, errorMessage } from '../../lib/api';
import { storeSells } from '../../lib/sectors';
import { SectionCard } from './parts';

/**
 * «وصف المتجر الإلكتروني» on the product page (26 › المتجر الإلكتروني): the description and the size
 * guide the shop's page shows (plain text), saved on their own, and the phones customers left on the
 * pieces that ran out, with a WhatsApp link to write to them when the piece is back.
 */

const textsPath = (id: string) => `/v1/products/${id}/shop-text`;
const alertsPath = (id: string) => `/v1/products/${id}/stock-alerts`;

const digitsOf = (phone: string) => phone.replace('+', '');

/** The message that opens on WhatsApp: the piece is back */
export function backInStockMessage(store: string, product: string, label: string | null): string {
  return `مرحباً، ${product}${label ? ` (${label})` : ''} توفّرت من جديد في ${store}. هل تريد أن نحجزها لك؟`;
}

export function ShopTextSection({
  productId,
  productName,
  disabled = false,
}: {
  /** Null for a product not saved yet */
  productId: string | null;
  productName: string;
  disabled?: boolean;
}) {
  const me = useMe();
  // Sizes and their guide belong to clothes and shoes; other stores see no size wording
  const fashion = storeSells(me.tenant.sectors, ['clothing']);
  const descId = useId();
  const guideId = useId();
  const [texts, setTexts] = useState<ProductTexts | null>(null);
  const [kept, setKept] = useState('');
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    if (!productId) return;
    apiFetch<ProductTexts>(textsPath(productId), { auth: true })
      .then((t) => {
        setTexts(t);
        setKept(JSON.stringify(t));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    apiFetch<{ items: StockAlert[] }>(alertsPath(productId), { auth: true })
      .then((r) => setAlerts(r.items))
      .catch(() => setAlerts([]));
  }, [productId]);
  useEffect(load, [load]);

  if (!productId) {
    return (
      <SectionCard title="وصف المتجر الإلكتروني" icon={<StoreIcon />}>
        <p className="text-sm text-ink-muted">احفظ المنتج أولاً، ثم اكتب وصفه ودليل مقاساته هنا.</p>
      </SectionCard>
    );
  }

  async function save() {
    if (!productId || !texts) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const done = await apiFetch<ProductTexts>(textsPath(productId), {
        method: 'PUT',
        body: texts,
        auth: true,
      });
      setTexts(done);
      setKept(JSON.stringify(done));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function told(alert: StockAlert) {
    try {
      await apiFetch(`/v1/stock-alerts/${alert.id}/notified`, { method: 'POST', auth: true });
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  }

  const dirty = texts !== null && JSON.stringify(texts) !== kept;
  const area =
    'w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden disabled:opacity-60 pointer-coarse:text-base';
  const waiting = alerts.filter((a) => !a.notifiedAt);
  return (
    <SectionCard
      title="وصف المتجر الإلكتروني"
      icon={<StoreIcon />}
      description="نص عادي يظهر في صفحة المنتج بالمتجر، ولا يُقرأ منه أي شكل أو رابط."
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={descId} className="text-sm font-semibold text-ink-muted">
          الوصف
        </label>
        <textarea
          id={descId}
          rows={4}
          disabled={disabled || !texts}
          value={texts?.description ?? ''}
          onChange={(e) => {
            setSaved(false);
            setTexts((t) => (t ? { ...t, description: e.target.value.slice(0, 4000) || null } : t));
          }}
          className={area}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={guideId} className="text-sm font-semibold text-ink-muted">
          {fashion ? 'دليل المقاسات' : 'معلومات إضافية للزبون'}
        </label>
        <textarea
          id={guideId}
          rows={4}
          disabled={disabled || !texts}
          value={texts?.sizeGuide ?? ''}
          placeholder={'S: الصدر 96\nM: الصدر 100'}
          onChange={(e) => {
            setSaved(false);
            setTexts((t) => (t ? { ...t, sizeGuide: e.target.value.slice(0, 2000) || null } : t));
          }}
          className={area}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={disabled || !dirty}
          onClick={() => void save()}
        >
          احفظ الوصف
        </Button>
        {saved ? <span className="text-sm font-semibold text-success-ink">حُفظ الوصف.</span> : null}
      </div>

      {alerts.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 className="text-base font-semibold text-ink">
            زبائن ينتظرون التوفر <span className="num text-ink-muted">({waiting.length})</span>
          </h3>
          <ul aria-label="زبائن ينتظرون التوفر" className="flex flex-col divide-y divide-line">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
                <bdi dir="ltr" className="num font-semibold text-ink">
                  {a.phone}
                </bdi>
                <span className="text-ink-muted">{a.variantLabel ?? 'القطعة'}</span>
                {a.inStock ? <Badge tone="success">توفرت</Badge> : <Badge tone="neutral">نفدت</Badge>}
                {a.notifiedAt ? <Badge tone="brand">أُبلغ</Badge> : null}
                <span className="ms-auto flex items-center gap-2">
                  <a
                    href={`https://wa.me/${digitsOf(a.phone)}?text=${encodeURIComponent(
                      backInStockMessage(me.tenant.name, productName, a.variantLabel),
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`راسل ${a.phone} على واتساب`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2 font-semibold text-brand-ink underline decoration-transparent underline-offset-4 hover:decoration-current"
                  >
                    <SendIcon size={16} />
                    راسله على واتساب
                  </a>
                  {a.notifiedAt ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon={<CheckIcon size={16} />}
                      onClick={() => void told(a)}
                    >
                      تم إبلاغه
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}
