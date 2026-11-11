import { useState } from 'react';
import { Alert, Button, CheckIcon, SerialIcon, TextField } from '@serva/ui';
import type { CartLine } from './cart';
import { SalePanel } from './SalePanel';

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
    <SalePanel label="الرقم التسلسلي" title={line.name} icon={<SerialIcon size={20} />}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        className="flex flex-col gap-5"
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
          inputClassName="num"
        />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" icon={<CheckIcon size={20} />}>
            احفظ الرقم
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            لاحقاً
          </Button>
        </div>
      </form>
    </SalePanel>
  );
}
