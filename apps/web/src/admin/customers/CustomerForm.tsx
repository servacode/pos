import { useState } from 'react';
import type { CustomerDetail } from '@serva/core';
import { Alert, Button, TextField } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { createCustomer, updateCustomer } from './api';

/** Pounds typed («50000» or «50,000») to minor units; '' is no limit */
function limitOf(text: string): number | null | 'bad' {
  const clean = text.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!clean) return null;
  if (!/^\d{1,12}$/.test(clean)) return 'bad';
  return Number(clean) * 100;
}

/** Adds a customer, or edits one: name, phone, tax number, address, notes and the credit limit. */
export function CustomerForm({
  customer,
  onSaved,
  onCancel,
}: {
  customer?: CustomerDetail;
  onSaved: (saved: CustomerDetail) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone?.replace(/^\+963/, '0') ?? '');
  const [taxNumber, setTaxNumber] = useState(customer?.taxNumber ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [limit, setLimit] = useState(
    customer?.creditLimitMinor !== null && customer?.creditLimitMinor !== undefined
      ? String(customer.creditLimitMinor / 100)
      : '',
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const creditLimitMinor = limitOf(limit);
    if (creditLimitMinor === 'bad') {
      setFields({ creditLimitMinor: 'اكتب الحد أرقاماً بالليرة، أو اتركه فارغاً بلا حد' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const input = { name, phone, taxNumber, address, notes, creditLimitMinor };
    try {
      onSaved(customer ? await updateCustomer(customer.id, input) : await createCustomer(input));
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={customer ? 'عدّل الزبون' : 'زبون جديد'}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="اسم الزبون"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <TextField
          label="الجوال"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fields.phone}
        />
        <TextField
          label="حد الدين بالليرة"
          hint="فارغ: بلا حد. البيع فوق الحد يُقبل ويظهر تنبيه."
          inputMode="numeric"
          dir="ltr"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          error={fields.creditLimitMinor}
        />
        <TextField
          label="الرقم الضريبي"
          value={taxNumber}
          onChange={(e) => setTaxNumber(e.target.value)}
          error={fields.taxNumber}
        />
        <TextField
          label="العنوان"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          error={fields.address}
        />
        <TextField
          label="ملاحظات"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={fields.notes}
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={saving}>
          احفظ
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
