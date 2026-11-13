import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  normalizeArabic,
  normalizeContactPhone,
  type CustomerDetail,
  type CustomerListItem,
} from '@serva/core';
import { Alert, Button, Card, CardHeader, Switch, TextField, UserIcon } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { createCustomer, updateCustomer } from './api';

/** Pounds typed («50000» or «50,000») to minor units; '' is no limit */
function limitOf(text: string): number | null | 'bad' {
  const clean = text.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!clean) return null;
  if (!/^\d{1,12}$/.test(clean)) return 'bad';
  return Number(clean) * 100;
}

/** A part of the form: its title and a line of help at the start, its fields beside them. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-4 border-t border-line pt-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h4 className="text-[0.9375rem] font-semibold text-ink">{title}</h4>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Customers already in the store with the same phone, or the same name: the owner is told before a
 * second one is made, and can open the one that exists.
 */
export function sameCustomers(
  existing: readonly CustomerListItem[],
  name: string,
  phone: string,
  selfId?: string,
): CustomerListItem[] {
  const wantedPhone = phone.trim() ? normalizeContactPhone(phone) : null;
  const wantedName = normalizeArabic(name);
  return existing.filter(
    (c) =>
      c.id !== selfId &&
      ((wantedPhone !== null && c.phone === wantedPhone) ||
        (wantedName.length >= 2 && normalizeArabic(c.name) === wantedName)),
  );
}

/** Adds a customer, or edits one: name, phone, tax number, address, notes and the credit limit. */
export function CustomerForm({
  customer,
  existing = [],
  onSaved,
  onCancel,
}: {
  customer?: CustomerDetail;
  /** The store's customers, to warn about a duplicate */
  existing?: readonly CustomerListItem[];
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
  const [wholesale, setWholesale] = useState(customer?.priceTier === 'wholesale');
  const [noMessages, setNoMessages] = useState(customer?.noMessages ?? false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const same = sameCustomers(existing, name, phone, customer?.id);

  async function save() {
    const creditLimitMinor = limitOf(limit);
    if (creditLimitMinor === 'bad') {
      setFields({ creditLimitMinor: 'اكتب الحد أرقاماً بالليرة، أو اتركه فارغاً بلا حد' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const input = {
      name,
      phone,
      taxNumber,
      address,
      notes,
      creditLimitMinor,
      priceTier: wholesale ? ('wholesale' as const) : ('retail' as const),
      noMessages,
    };
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
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card>
        <CardHeader
          icon={<UserIcon />}
          title={customer ? 'بيانات الزبون' : 'زبون جديد'}
          description={
            customer ? 'عدّل ما تغيّر، ثم احفظ.' : 'الاسم وحده يكفي للبدء، والباقي تضيفه حين تحتاجه.'
          }
        />
        <div className="flex flex-col gap-6">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {same.length > 0 ? (
            <Alert tone="warning" title="يوجد زبون بالاسم أو الرقم نفسه">
              <ul className="flex flex-col gap-1">
                {same.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <Link to={`/customers/${c.id}`} className="font-semibold underline underline-offset-4">
                      افتح {c.name}
                    </Link>
                    {c.phone ? (
                      <>
                        {' · '}
                        <bdi dir="ltr" className="num">
                          {c.phone}
                        </bdi>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-1">يمكنك الحفظ رغم ذلك إن كان زبوناً آخر فعلاً.</p>
            </Alert>
          ) : null}
          <FormSection title="البيانات" description="كيف تعرفه وتصل إليه.">
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
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
                label="العنوان"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                error={fields.address}
              />
              <TextField
                label="الرقم الضريبي"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                error={fields.taxNumber}
              />
              <TextField
                label="ملاحظات"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                error={fields.notes}
                className="sm:col-span-2"
              />
            </div>
          </FormSection>
          <FormSection title="البيع بالآجل" description="حدّ دينه، والسعر الذي يشتري به.">
            <div className="flex flex-col gap-4">
              <TextField
                label="حد الدين بالليرة"
                hint="فارغ: بلا حد. البيع فوق الحد يُقبل ويظهر تنبيه."
                inputMode="numeric"
                dir="ltr"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                error={fields.creditLimitMinor}
                className="sm:max-w-xs"
              />
              <div className="flex flex-col divide-y divide-line rounded-control border border-line px-4">
                <Switch
                  label="زبون جملة"
                  description="عند اختياره على الكاشير تتحوّل الفاتورة إلى سعر الجملة"
                  checked={wholesale}
                  onCheckedChange={setWholesale}
                  className="py-3"
                />
                <Switch
                  label="لا يريد رسائل"
                  description="لا تصله رسائل المحل على واتساب (العروض والتشكيلات الجديدة)"
                  checked={noMessages}
                  onCheckedChange={setNoMessages}
                  className="py-3"
                />
              </div>
            </div>
          </FormSection>
          <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
            <Button variant="secondary" onClick={onCancel}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              احفظ
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
