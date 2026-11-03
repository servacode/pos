import { useState } from 'react';
import { Alert, Button, TextField } from '@serva/ui';
import type { CartLine } from './cart';

/**
 * «الرقم التسلسلي / IMEI» (03 › الإلكترونيات): the number of the piece sold, scanned from its box or
 * typed, beside the cart. The sale cannot be paid until each such piece has its number.
 */
export function SerialPanel({
  line,
  taken,
  onSave,
  onCancel,
}: {
  line: CartLine;
  /** Numbers already on other lines of this sale */
  taken: ReadonlySet<string>;
  onSave: (serials: string[]) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(line.serials?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    const serial = value.replace(/\s+/g, '').toUpperCase();
    if (serial.length < 3) {
      setError('امسح الرقم من العلبة أو اكتبه.');
      return;
    }
    if (taken.has(serial)) {
      setError('هذا الرقم على سطر آخر في الفاتورة.');
      return;
    }
    onSave([serial]);
  }

  return (
    <section
      aria-label="الرقم التسلسلي"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
    >
      <h2 className="text-lg font-bold text-ink">{line.name}</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label="الرقم التسلسلي أو IMEI"
          dir="ltr"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex gap-3">
          <Button type="submit">احفظ الرقم</Button>
          <Button variant="secondary" onClick={onCancel}>
            لاحقاً
          </Button>
        </div>
      </form>
    </section>
  );
}
