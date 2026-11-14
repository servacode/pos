import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { MAX_PRODUCT_IMAGES, type ProductImage } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CameraIcon,
  DeleteIcon,
  IconButton,
  IconChip,
  Select,
  Spinner,
  cn,
} from '@serva/ui';
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
export const ImagesEditor = memo(function ImagesEditor({
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
  const addId = useId();

  const load = useCallback(() => {
    if (!productId) return;
    listProductImages(productId)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [productId]);
  useEffect(load, [load]);

  if (!productId) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-dashed border-line-control/50 p-4">
        <IconChip tone="neutral">
          <CameraIcon />
        </IconChip>
        <p className="text-sm text-ink-muted">احفظ المنتج أولاً، ثم أضف صوره هنا.</p>
      </div>
    );
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
  const canAdd = !disabled && list.length < MAX_PRODUCT_IMAGES;
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {list.length === 0 && items && !canAdd ? (
        <p className="text-sm text-ink-muted">لا صور بعد. الصورة الأولى هي الرئيسية في المتجر الإلكتروني.</p>
      ) : null}
      <ul
        aria-label="صور المنتج"
        className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', list.length === 0 && 'hidden')}
      >
        {list.map((image, index) => {
          const name = index === 0 ? 'الصورة الرئيسية' : `الصورة ${index + 1}`;
          return (
            <li
              key={image.id}
              className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-2 shadow-e1"
            >
              <div className="relative">
                <img
                  src={image.thumbUrl}
                  alt={index === 0 ? 'الصورة الرئيسية' : `صورة ${index + 1}`}
                  className="aspect-square w-full rounded-small bg-surface-muted object-cover"
                  loading="lazy"
                />
                {index === 0 ? (
                  <Badge tone="brand" className="absolute start-2 top-2">
                    الرئيسية
                  </Badge>
                ) : null}
              </div>
              {optionValues.length > 0 ? (
                <Select
                  label={`لمن ${name}`}
                  hideLabel
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
                </Select>
              ) : null}
              <div className="flex items-center justify-between gap-1">
                {index === 0 ? (
                  <span className="px-1 text-xs text-ink-subtle">تظهر أولاً في المتجر</span>
                ) : (
                  <Button
                    size="xs"
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
                <IconButton
                  size="sm"
                  label={`احذف ${name}`}
                  icon={<DeleteIcon />}
                  disabled={disabled || busy}
                  onClick={() => void run(() => deleteProductImage(productId, image.id))}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {canAdd ? (
        <div className="relative">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            aria-label="اختر صوراً"
            className="sr-only"
            onChange={(e) => void add(e.target.files)}
          />
          <button
            type="button"
            aria-labelledby={`${addId}-title`}
            aria-describedby={`${addId}-hint`}
            disabled={busy}
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-line-control/50 px-6 py-6 text-center transition-[background-color,border-color] duration-120 ease-standard enabled:hover:border-brand/50 enabled:hover:bg-brand-soft/40 disabled:cursor-wait"
          >
            <span className="mb-1 grid size-12 place-items-center rounded-card bg-brand-soft text-brand">
              {busy ? <Spinner size={24} /> : <CameraIcon size={24} />}
            </span>
            <span id={`${addId}-title`} className="font-semibold text-ink">
              أضف صوراً
            </span>
            <span id={`${addId}-hint`} className="max-w-md text-sm text-ink-muted">
              من الجوال تفتح الكاميرا أو المعرض. تُصغَّر الصورة قبل رفعها، حتى {MAX_PRODUCT_IMAGES} صورة
              للمنتج.
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
