import { useEffect, useRef, useState } from 'react';
import { MAX_PURCHASE_ATTACHMENTS, type PurchaseAttachment } from '@serva/core';
import { Alert, Button, CloseIcon } from '@serva/ui';
import { apiDownload, errorMessage } from '../../lib/api';
import { resizeImage } from '../../lib/images';
import { addPurchasePhoto, removePurchasePhoto } from './api';

/**
 * Round 62: the photos of the supplier's paper invoice. A picture is made small in the browser (like a product's), kept
 * with the store's data, and opens full size in its own tab. Posting nothing: it only describes the invoice.
 * The photo shows the supplier's prices, so the server gives it only with the token: an <img> cannot carry one, so each
 * picture is fetched and shown from a local object URL (released when it changes or the screen goes).
 */
function Thumb({ photo, label }: { photo: PurchaseAttachment; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setSrc(null);
    apiDownload(photo.thumbUrl)
      .then(({ blob }) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setSrc(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.thumbUrl]);
  return src ? (
    <img src={src} alt={label} className="h-24 w-24 rounded-control object-cover" />
  ) : (
    <span aria-hidden="true" className="block h-24 w-24 rounded-control bg-surface-muted" />
  );
}

export function PurchasePhotos({
  purchaseId,
  photos,
  onChange,
}: {
  purchaseId: string;
  photos: PurchaseAttachment[];
  onChange: (photos: PurchaseAttachment[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const made = await addPurchasePhoto(purchaseId, await resizeImage(file));
      onChange(photos.some((p) => p.id === made.id) ? photos : [...photos, made]);
    } catch (e) {
      setError(e instanceof Error && e.message === 'not an image' ? 'اختر صورة.' : errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  // The tab opens at once (a popup after a wait is blocked) and then shows the photo from a local object URL
  async function open(photo: PurchaseAttachment) {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { blob } = await apiDownload(photo.url);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      setError(errorMessage(e));
    }
  }
  async function remove(photo: PurchaseAttachment) {
    setBusy(true);
    setError(null);
    try {
      await removePurchasePhoto(purchaseId, photo.id);
      onChange(photos.filter((p) => p.id !== photo.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="صورة الفاتورة الورقية" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">صورة الفاتورة الورقية</h3>
        {photos.length < MAX_PURCHASE_ATTACHMENTS ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="اختر صورة الفاتورة"
              tabIndex={-1}
              onChange={(e) => void add(e.target.files?.[0])}
            />
            <Button variant="ghost" size="sm" loading={busy} onClick={() => input.current?.click()}>
              {photos.length === 0 ? 'أضف صورة' : 'أضف صورة أخرى'}
            </Button>
          </>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {photos.length > 0 ? (
        <ul className="flex flex-wrap gap-3" aria-label="صور الفاتورة">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              <button
                type="button"
                aria-label={`افتح الصورة ${i + 1}`}
                onClick={() => void open(p)}
                className="block rounded-control"
              >
                <Thumb photo={p} label={`صورة الفاتورة ${i + 1}`} />
              </button>
              <button
                type="button"
                aria-label={`احذف الصورة ${i + 1}`}
                disabled={busy}
                onClick={() => void remove(p)}
                className="absolute -end-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-surface text-ink-muted shadow-e2 hover:text-danger-ink"
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">لم تُرفق صورة. صوّر ورقة المورد لتبقى مع الفاتورة.</p>
      )}
    </section>
  );
}
