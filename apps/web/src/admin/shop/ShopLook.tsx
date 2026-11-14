import { useId, useRef, useState } from 'react';
import { SHOP_ACCENTS, type OnlineStoreSettings, type ShopAccent } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CameraIcon,
  DeleteIcon,
  EyeIcon,
  SegmentedControl,
  TextField,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../../lib/api';
import { resizeImage } from '../../lib/images';

/**
 * «شكل المتجر» (26 › الشكل): the logo, the cover banner, a short line under the name and the colour
 * of the shop's buttons, chosen among the identity's own families so the contrast always holds.
 * The pictures are sent as they are picked (the store's settings must be saved once before).
 */

const ACCENT_NAMES: Record<ShopAccent, string> = { emerald: 'أخضر', teal: 'فيروزي', blue: 'أزرق' };
/** The swatch of each family, by its own tokens */
const SWATCH: Record<ShopAccent, string> = {
  emerald: 'bg-brand',
  teal: 'bg-accent',
  blue: 'bg-info',
};

type Slot = 'logo' | 'cover';

const putImage = (slot: Slot, image: Awaited<ReturnType<typeof resizeImage>>) =>
  apiFetch<OnlineStoreSettings>(`/v1/online-store/image/${slot}`, { method: 'PUT', body: image, auth: true });
const dropImage = (slot: Slot) =>
  apiFetch<OnlineStoreSettings>(`/v1/online-store/image/${slot}`, { method: 'DELETE', auth: true });

export function ShopLook({
  form,
  saved,
  onChange,
  onImages,
}: {
  form: OnlineStoreSettings;
  /** The settings were saved once: only then can a picture be kept */
  saved: boolean;
  onChange: (patch: Partial<OnlineStoreSettings>) => void;
  /** The server's answer after a picture: its new version and addresses */
  onImages: (settings: OnlineStoreSettings) => void;
}) {
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const logoId = useId();
  const coverId = useId();

  async function pick(slot: Slot, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(slot);
    setError(null);
    try {
      let resized;
      try {
        resized = await resizeImage(file);
      } catch {
        setError(`«${file.name}» ليس صورة يمكن قراءتها. اختر صورة JPG أو PNG.`);
        return;
      }
      onImages(await putImage(slot, resized));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      const input = slot === 'logo' ? logoInput.current : coverInput.current;
      if (input) input.value = '';
    }
  }

  async function remove(slot: Slot) {
    setBusy(slot);
    setError(null);
    try {
      onImages(await dropImage(slot));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const accent = form.accent ?? 'emerald';
  return (
    <Card>
      <CardHeader
        icon={<EyeIcon />}
        title="شكل المتجر"
        description="شعارك وصورة الغلاف وعبارة قصيرة ولون الأزرار، تظهر في أعلى المتجر."
      />
      <div className="flex flex-col gap-5">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!saved ? (
          <p className="text-sm text-ink-muted">احفظ إعدادات المتجر أولاً، ثم أضف الشعار والغلاف.</p>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p id={logoId} className="text-sm font-semibold text-ink">
              الشعار
            </p>
            {form.logoUrl ? (
              <img
                src={form.logoUrl}
                alt="شعار المتجر"
                className="size-20 rounded-control border border-line object-cover"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                aria-labelledby={logoId}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => void pick('logo', e.target.files)}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<CameraIcon size={16} />}
                disabled={!saved}
                loading={busy === 'logo'}
                onClick={() => logoInput.current?.click()}
              >
                {form.logoUrl ? 'غيّر الشعار' : 'أضف الشعار'}
              </Button>
              {form.logoUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<DeleteIcon size={16} />}
                  disabled={busy !== null}
                  onClick={() => void remove('logo')}
                >
                  أزل الشعار
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p id={coverId} className="text-sm font-semibold text-ink">
              صورة الغلاف
            </p>
            {form.coverUrl ? (
              <img
                src={form.coverUrl}
                alt="غلاف المتجر"
                className="h-20 w-full rounded-control border border-line object-cover"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                aria-labelledby={coverId}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => void pick('cover', e.target.files)}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<CameraIcon size={16} />}
                disabled={!saved}
                loading={busy === 'cover'}
                onClick={() => coverInput.current?.click()}
              >
                {form.coverUrl ? 'غيّر الغلاف' : 'أضف الغلاف'}
              </Button>
              {form.coverUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<DeleteIcon size={16} />}
                  disabled={busy !== null}
                  onClick={() => void remove('cover')}
                >
                  أزل الغلاف
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <TextField
          label="عبارة قصيرة تحت اسم المتجر (اختياري)"
          placeholder="أناقة كل يوم"
          value={form.tagline ?? ''}
          onChange={(e) => onChange({ tagline: e.target.value.slice(0, 80) || null })}
        />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <SegmentedControl
            label="لون الأزرار"
            value={accent}
            onValueChange={(next: ShopAccent) => onChange({ accent: next })}
            options={SHOP_ACCENTS.map((a) => ({ value: a, label: ACCENT_NAMES[a] }))}
          />
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <span aria-hidden="true" className={`size-4 rounded-full ${SWATCH[accent]}`} />
            ألوان الهوية فقط، فتبقى القراءة واضحة في الوضعين الفاتح والداكن.
          </p>
        </div>
      </div>
    </Card>
  );
}
