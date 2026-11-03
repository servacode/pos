import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_PRODUCT_IMAGES, type ProductImage } from '@serva/core';
import { Alert, Button, DeleteIcon, IconButton } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { resizeImage } from '../../lib/images';
import {
  addProductImage,
  deleteProductImage,
  listProductImages,
  orderProductImages,
  setImageOption,
} from '../catalog/api';

/**
 * «الصور» on the product card (03 › الألبسة: صور القطع; 26 › المتجر الإلكتروني): several pictures,
 * taken with the phone's camera or picked from the computer, resized before they are sent. The
 * first is the main one; a picture can belong to one colour (or any option value) of the pieces, so
 * the shop's page shows the red shirt when red is chosen.
 */
export function ImagesEditor({
  productId,
  optionValues,
  disabled = false,
}: {
  /** Null for a product not saved yet: pictures come after the first save */
  productId: string | null;
  /** The values of the pieces' options a picture can belong to («أحمر», «أزرق») */
  optionValues: readonly string[];
  disabled?: boolean;
}) {
  const [items, setItems] = useState<ProductImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!productId) return;
    listProductImages(productId)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [productId]);
  useEffect(load, [load]);

  if (!productId) {
    return <p className="text-ink-muted">احفظ المنتج أولاً، ثم أضف صوره هنا.</p>;
  }

  async function add(files: FileList | null) {
    if (!files || !productId) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_PRODUCT_IMAGES - (items?.length ?? 0);
      for (const file of [...files].slice(0, Math.max(0, room))) {
        let resized;
        try {
          resized = await resizeImage(file);
        } catch {
          setError(`«${file.name}» ليس صورة يمكن قراءتها. اختر صورة JPG أو PNG.`);
          continue;
        }
        await addProductImage(productId, { ...resized, optionValue: null });
      }
      if (files.length > room) setError(`للمنتج ${MAX_PRODUCT_IMAGES} صورة على الأكثر.`);
      load();
    } catch (e) {
      setError(errorMessage(e));
      load();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  const list = items ?? [];
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {list.length === 0 && items ? (
        <p className="text-ink-muted">لا صور بعد. الصورة الأولى هي الرئيسية في المتجر الإلكتروني.</p>
      ) : null}
      <ul aria-label="صور المنتج" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((image, index) => (
          <li key={image.id} className="flex flex-col gap-2 rounded-control border border-line p-2">
            <img
              src={image.thumbUrl}
              alt={index === 0 ? 'الصورة الرئيسية' : `صورة ${index + 1}`}
              className="aspect-square w-full rounded-control bg-surface-muted object-cover"
              loading="lazy"
            />
            {index === 0 ? (
              <span className="text-center text-xs font-semibold text-brand-ink">الرئيسية</span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() =>
                  void run(() =>
                    orderProductImages(productId, [
                      image.id,
                      ...list.filter((i) => i.id !== image.id).map((i) => i.id),
                    ]),
                  )
                }
              >
                اجعلها الرئيسية
              </Button>
            )}
            {optionValues.length > 0 ? (
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                للون أو المقاس
                <select
                  aria-label={`لمن ${index === 0 ? 'الصورة الرئيسية' : `الصورة ${index + 1}`}`}
                  className="min-h-10 rounded-control border border-line bg-surface px-2 text-sm text-ink"
                  value={image.optionValue ?? ''}
                  disabled={disabled || busy}
                  onChange={(e) => void run(() => setImageOption(productId, image, e.target.value || null))}
                >
                  <option value="">لكل القطع</option>
                  {optionValues.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <IconButton
              label={`احذف ${index === 0 ? 'الصورة الرئيسية' : `الصورة ${index + 1}`}`}
              icon={<DeleteIcon />}
              disabled={disabled || busy}
              onClick={() => void run(() => deleteProductImage(productId, image.id))}
            />
          </li>
        ))}
      </ul>
      {!disabled && list.length < MAX_PRODUCT_IMAGES ? (
        <div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            aria-label="اختر صوراً"
            className="sr-only"
            onChange={(e) => void add(e.target.files)}
          />
          <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            أضف صوراً
          </Button>
          <p className="mt-1 text-xs text-ink-muted">
            من الجوال تفتح الكاميرا أو المعرض. تُصغَّر الصورة قبل رفعها، حتى {MAX_PRODUCT_IMAGES} صورة للمنتج.
          </p>
        </div>
      ) : null}
    </div>
  );
}
