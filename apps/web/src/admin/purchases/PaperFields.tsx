import { useRef } from 'react';
import { MAX_PURCHASE_ATTACHMENTS } from '@serva/core';
import { Button, CloseIcon, NumberField, SegmentedControl } from '@serva/ui';

/**
 * Round 64: the paper's own figures on a new supplier invoice: the discount (an amount, or a percent of the paper's total, the
 * way a supplier writes «خصم 5%»), the extra charges, and the photos of the paper (several, sent once the invoice is saved).
 * The form keeps the state and does the arithmetic; this is the fields.
 */
export function PaperFields({
  unit,
  discount,
  onDiscount,
  percent,
  onPercent,
  discountError,
  discountAmount,
  charges,
  onCharges,
  chargesError,
  photos,
  onPhotos,
  renderMoney,
}: {
  /** «دولار» or «ليرة» */
  unit: string;
  discount: string;
  onDiscount: (v: string) => void;
  percent: boolean;
  onPercent: (v: boolean) => void;
  discountError: string | undefined;
  /** In percent mode, what the percent comes to (minor units), to show beside the field */
  discountAmount: number | null;
  charges: string;
  onCharges: (v: string) => void;
  chargesError: string | undefined;
  photos: File[];
  onPhotos: (files: File[]) => void;
  renderMoney: (minor: number) => React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const room = MAX_PURCHASE_ATTACHMENTS - photos.length;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="flex flex-col gap-2">
        <NumberField
          label={percent ? 'خصم المورد (نسبة مئوية %)' : `خصم المورد (${unit})`}
          hint={percent && discountAmount ? <>يساوي {renderMoney(discountAmount)}</> : 'اختياري'}
          decimals={2}
          value={discount}
          onValueChange={onDiscount}
          error={discountError}
        />
        <SegmentedControl
          label="نوع الخصم"
          value={percent ? 'percent' : 'amount'}
          onValueChange={(v) => onPercent(v === 'percent')}
          options={[
            { value: 'amount', label: 'مبلغ' },
            { value: 'percent', label: 'نسبة %' },
          ]}
        />
      </div>
      <NumberField
        label={`رسوم إضافية: شحن وغيره (${unit})`}
        hint="اختياري"
        decimals={2}
        value={charges}
        onValueChange={onCharges}
        error={chargesError}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">صورة الورقة</span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="صورة فاتورة المورد الورقية"
          tabIndex={-1}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) onPhotos([...photos, ...picked].slice(0, MAX_PURCHASE_ATTACHMENTS));
            e.target.value = '';
          }}
        />
        <span className="flex flex-wrap items-center gap-2">
          {room > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
              {photos.length === 0 ? 'أرفق صورة' : 'أضف صورة أخرى'}
            </Button>
          ) : null}
          {photos.length === 0 ? <span className="text-sm text-ink-subtle">اختياري، حتى 6 صور</span> : null}
        </span>
        {photos.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="الصور المرفقة">
            {photos.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="min-w-0 truncate" dir="ltr">
                  {f.name}
                </span>
                <button
                  type="button"
                  aria-label={`أزل الصورة ${f.name}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:text-danger-ink"
                  onClick={() => onPhotos(photos.filter((_, j) => j !== i))}
                >
                  <CloseIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
