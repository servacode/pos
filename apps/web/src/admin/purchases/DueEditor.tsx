import { useState } from 'react';
import { Alert, Button, TextField, useDigits } from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { dayText } from '../../lib/dates';
import { errorMessage } from '../../lib/api';
import { changePurchaseDue } from './api';

/**
 * Round 64: an invoice's due date, with «عدّل الاستحقاق»: a mistyped day or a renegotiated term is corrected here (the server
 * keeps who changed it, from what, and why; nothing is posted). A date can be taken off too.
 */
export function DueEditor({
  purchaseId,
  dueDate,
  minDate,
  onChanged,
}: {
  purchaseId: string;
  dueDate: string | null;
  /** The invoice's own day: the due date cannot come before it */
  minDate: string;
  onChanged: (dueDate: string | null) => void;
}) {
  const digits = useDigits();
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(dueDate ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await changePurchaseDue(purchaseId, next, reason.trim() || undefined);
      onChanged(r.dueDate);
      setEditing(false);
      setReason('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {dueDate ? <>تستحق في {dayText(dueDate, digits)}</> : 'بلا تاريخ استحقاق'}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setDay(dueDate ?? '');
            setEditing(true);
          }}
        >
          عدّل الاستحقاق
        </Button>
      </p>
    );
  }
  return (
    <div
      className="flex flex-col gap-3 rounded-control bg-surface-muted p-3"
      role="group"
      aria-label="تعديل الاستحقاق"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateField label="تاريخ الاستحقاق الجديد" value={day} onChange={setDay} min={minDate} />
        <TextField
          label="السبب"
          hint="اختياري"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={day === '' || day === dueDate}
          onClick={() => void save(day)}
        >
          احفظ
        </Button>
        {dueDate ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
            أزل التاريخ
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          ألغِ
        </Button>
      </div>
    </div>
  );
}
