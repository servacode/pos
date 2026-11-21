import { useState } from 'react';
import { COUNT_NOUNS, countNoun, normalizeArabic } from '@serva/core';
import { Alert, Button, Dialog, cn } from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { resizeImage } from '../../lib/images';
import { addProductImage, listProducts } from '../catalog/api';

/** What a picture's file name says about the product it belongs to */
export interface PhotoKey {
  /** All digits (a barcode scanned onto the file name), or null */
  code: string | null;
  /** The name without its extension, «_ -» as spaces and a trailing «(1)» dropped */
  name: string;
}

/** «قميص أزرق.jpg» → name «قميص أزرق»; «6281007035105.png» → a barcode. */
export function photoKey(fileName: string): PhotoKey {
  const base = fileName
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const digits = base.replace(/\s+/g, '');
  return { code: /^\d{6,}$/.test(digits) ? digits : null, name: base };
}

type Row =
  | { file: File; state: 'matched'; productId: string; productName: string }
  | { file: File; state: 'none' | 'many' }
  | { file: File; state: 'done' | 'failed'; productName: string; error?: string };

/** The product a file belongs to: by barcode when the name is one, else by its exact name or the only product the name finds. */
async function matchFile(file: File): Promise<Row> {
  const key = photoKey(file.name);
  if (key.code) {
    const byCode = await listProducts({ q: key.code, status: 'active', limit: 2 });
    const only = byCode.items.length === 1 ? byCode.items[0] : undefined;
    return only
      ? { file, state: 'matched', productId: only.id, productName: only.nameAr }
      : { file, state: 'none' };
  }
  if (!key.name) return { file, state: 'none' };
  const page = await listProducts({ q: key.name, status: 'active', limit: 5 });
  const wanted = normalizeArabic(key.name);
  const exact = page.items.filter((p) => normalizeArabic(p.nameAr) === wanted);
  const pick = exact.length === 1 ? exact[0] : page.items.length === 1 ? page.items[0] : undefined;
  if (pick) return { file, state: 'matched', productId: pick.id, productName: pick.nameAr };
  return { file, state: page.items.length > 1 ? 'many' : 'none' };
}

/**
 * «أضف صوراً دفعة واحدة»: many picture files at once, each matched to its product by the file's
 * name (the product's name or its barcode), resized in the browser and sent through the same
 * endpoint as the card's «الصور». Nothing is sent before the owner sees which product each one goes to.
 */
export function BulkPhotos({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<'matching' | 'sending' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy('matching');
    try {
      const out: Row[] = [];
      for (const file of [...files]) out.push(await matchFile(file));
      setRows(out);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('sending');
    const next: Row[] = [];
    for (const row of rows) {
      if (row.state !== 'matched') {
        next.push(row);
        continue;
      }
      try {
        await addProductImage(row.productId, await resizeImage(row.file));
        next.push({ file: row.file, state: 'done', productName: row.productName });
      } catch (caught) {
        next.push({
          file: row.file,
          state: 'failed',
          productName: row.productName,
          error: errorMessage(caught),
        });
      }
      setRows([...next, ...rows.slice(next.length)]);
    }
    setRows(next);
    setBusy(null);
    onDone();
  }

  const ready = rows.filter((r) => r.state === 'matched').length;
  const done = rows.filter((r) => r.state === 'done').length;
  const close = () => {
    setRows([]);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && busy === null && close()}
      size="md"
      title="أضف صوراً دفعة واحدة"
      description="سمِّ كل ملف باسم المنتج أو باركوده، مثل «قميص أزرق.jpg»، وسنضع الصورة على منتجها."
      actions={
        <>
          <Button variant="secondary" disabled={busy !== null} onClick={close}>
            {done > 0 ? 'تم' : 'إلغاء'}
          </Button>
          <Button
            loading={busy === 'sending'}
            disabled={ready === 0 || busy !== null}
            onClick={() => void send()}
          >
            {ready > 0 ? `ارفع ${countNoun(ready, COUNT_NOUNS.photo, String(ready), true)}` : 'ارفع الصور'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-card border border-dashed border-line-control bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted hover:border-brand">
          <span className="font-semibold text-ink">
            {busy === 'matching' ? 'نطابق الصور مع المنتجات…' : 'اختر الصور أو اسحبها إلى هنا'}
          </span>
          <span>يمكنك اختيار عدة صور معاً.</span>
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="ملفات الصور"
            className="sr-only"
            disabled={busy !== null}
            onChange={(event) => {
              void pick(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        {rows.length > 0 ? (
          <ul
            aria-label="الصور المختارة"
            className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto text-sm"
          >
            {rows.map((row, index) => (
              <li
                key={`${row.file.name}-${String(index)}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <bdi dir="ltr" className="min-w-0 truncate text-ink-muted">
                  {row.file.name}
                </bdi>
                <span
                  className={cn(
                    'font-semibold',
                    row.state === 'matched' || row.state === 'done' ? 'text-ink' : 'text-warning-ink',
                    row.state === 'failed' && 'text-danger-ink',
                  )}
                >
                  {row.state === 'matched' ? `← ${row.productName}` : null}
                  {row.state === 'done' ? `وُضعت على «${row.productName}»` : null}
                  {row.state === 'failed' ? `تعذّر: ${row.error ?? ''}` : null}
                  {row.state === 'none' ? 'لا منتج بهذا الاسم' : null}
                  {row.state === 'many' ? 'أكثر من منتج بهذا الاسم: اجعل الاسم كاملاً' : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
