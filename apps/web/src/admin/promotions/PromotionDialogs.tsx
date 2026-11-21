import { useState } from 'react';
import type { Promotion } from '@serva/core';
import { Alert, Button, Dialog } from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { errorMessage } from '../../lib/api';
import { dateBound, endDate } from './PromotionForm';
import { setPromotionEndDate } from './api';

/**
 * «غيّر تاريخ الانتهاء»: moves or clears the end of an offer from the list, so a sale that was good is
 * extended (or an ended one brought back) without opening the whole form. Only the end changes.
 */
export function EndDateDialog({
  promotion,
  onSaved,
  onCancel,
}: {
  promotion: Promotion;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(promotion.endsAt ? endDate(promotion.endsAt) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await setPromotionEndDate(promotion.id, { version: promotion.version, endsAt: dateBound(to, true) });
      onSaved(
        to
          ? `صار «${promotion.name}» ينتهي في آخر يوم من ${to.split('-').reverse().join('/')}.`
          : `«${promotion.name}» بلا تاريخ انتهاء الآن.`,
      );
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`تاريخ انتهاء «${promotion.name}»`}
      description="آخر يوم يعمل فيه العرض. اتركه فارغاً ليعمل دون تاريخ انتهاء."
    >
      <form
        aria-label="تاريخ الانتهاء"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <DateField label="حتى تاريخ" value={to} onChange={setTo} />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ التاريخ
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
