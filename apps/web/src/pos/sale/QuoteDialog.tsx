import { useState } from 'react';
import { Button, Dialog, Select, TextField } from '@serva/ui';

/** How long the offered prices stand */
const VALIDITY = [
  { days: 7, label: '7 أيام' },
  { days: 15, label: '15 يوماً' },
  { days: 30, label: '30 يوماً' },
] as const;

export interface QuoteChoice {
  /** The customer's name when no card is attached; null when left empty */
  customerName: string | null;
  validDays: number;
  notes: string | null;
  /** «احفظ كمسوّدة» keeps it as a draft and prints nothing; «احفظ واطبع» sends it */
  print: boolean;
}

/**
 * «عرض سعر» from the cart: a few optional details before the quotation is saved, so it never leaves
 * with no customer and a «sent» status by accident. The customer is optional (the attached card
 * fills it), the validity defaults to 15 days, and a draft is saved without printing.
 */
export function QuoteDialog({
  customerName,
  busy,
  onSave,
  onClose,
}: {
  /** The attached customer's name, when the cart has one */
  customerName: string | null;
  busy: boolean;
  onSave: (choice: QuoteChoice) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [days, setDays] = useState<number>(15);
  const [notes, setNotes] = useState('');
  const choice = (print: boolean): QuoteChoice => ({
    customerName: customerName ? null : name.trim() || null,
    validDays: days,
    notes: notes.trim() || null,
    print,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="md"
      title="عرض سعر"
      description="كل ما هنا اختياري. يُحفظ العرض برقم ويُرسل لاحقاً أو يُطبع الآن."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ألغِ
          </Button>
          <Button variant="secondary" onClick={() => onSave(choice(false))} loading={busy}>
            احفظ كمسوّدة
          </Button>
          <Button onClick={() => onSave(choice(true))} loading={busy}>
            احفظ واطبع
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {customerName ? (
          <p className="text-sm text-ink-muted">
            الزبون: <bdi className="font-semibold text-ink">{customerName}</bdi>
          </p>
        ) : (
          <TextField
            label="اسم الزبون (اختياري)"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <Select label="صالح لمدة" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {VALIDITY.map((v) => (
            <option key={v.days} value={v.days}>
              {v.label}
            </option>
          ))}
        </Select>
        <TextField
          label="ملاحظة (اختياري)"
          value={notes}
          maxLength={1000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
