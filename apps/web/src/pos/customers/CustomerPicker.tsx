import { useState } from 'react';
import type { CustomerRow } from '@serva/core/contracts/customers';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { normalizePhone } from '@serva/core/phone';
import { businessDateOf } from '@serva/core/sale';
import { normalizeArabic, toLatinDigits } from '@serva/core/text';
import {
  AddIcon,
  Alert,
  Avatar,
  BackIcon,
  Button,
  CustomersIcon,
  IconChip,
  Money,
  SearchIcon,
  TextField,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { usePos } from '../services';

export interface PickedCustomer {
  id: string;
  name: string;
  creditLimitMinor: number | null;
  priceTier?: 'retail' | 'wholesale';
}

/** Customers whose name or phone matches what the cashier typed, at most eight */
export function findCustomers(customers: readonly CustomerRow[], typed: string): CustomerRow[] {
  const q = normalizeArabic(typed);
  const digits = toLatinDigits(typed).replace(/\D/g, '').replace(/^0/, '');
  if (!q && !digits) return customers.slice(0, 8);
  return customers
    .filter(
      (c) =>
        (q && normalizeArabic(c.name).includes(q)) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
    )
    .slice(0, 8);
}

/**
 * «الزبون» on the till (12 › الزبون): find a customer of the store by name or phone, or add one,
 * which the till saves as a `customer` document and can sell to at once, offline too.
 */
export function CustomerPicker({
  catalog,
  createdBy,
  onPicked,
  onCancel,
}: {
  catalog: Catalog;
  createdBy: string;
  onPicked: (customer: PickedCustomer) => void;
  onCancel: () => void;
}) {
  const pos = usePos();
  const settings = catalog.settings!;
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const found = findCustomers(catalog.customers, search);

  async function add() {
    const phoneValue = phone.trim() ? normalizePhone(phone) : null;
    if (name.trim().length < 2) return setError('اكتب اسم الزبون.');
    if (phone.trim() && !phoneValue) return setError('رقم الجوال غير صحيح. مثال: 0912345678');
    setSaving(true);
    setError(null);
    try {
      const entry = await pos.save({
        type: 'customer',
        payload: { name: name.trim(), phone: phoneValue, createdBy },
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      onPicked({ id: entry.doc.id, name: name.trim(), creditLimitMinor: null });
    } catch {
      setError('لم يُحفظ الزبون. حاول مرة أخرى.');
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="اختر الزبون"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-e2 motion-safe:animate-rise"
    >
      <div className="flex items-center gap-3">
        <IconChip>
          <CustomersIcon />
        </IconChip>
        <h3 className="flex-1 text-lg font-semibold text-ink">{adding ? 'زبون جديد' : 'الزبون'}</h3>
        <Button variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
      {adding ? (
        <>
          <TextField
            label="اسم الزبون"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
          />
          <TextField
            label="الجوال (اختياري)"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 20))}
            inputClassName="num"
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button icon={<AddIcon />} onClick={() => void add()} loading={saving}>
              احفظ واختره
            </Button>
            <Button variant="secondary" icon={<BackIcon />} onClick={() => setAdding(false)}>
              ارجع للبحث
            </Button>
          </div>
        </>
      ) : (
        <>
          <TextField
            label="ابحث بالاسم أو الجوال"
            value={search}
            onChange={(e) => setSearch(e.target.value.slice(0, 60))}
            startAdornment={<SearchIcon className="ms-4 shrink-0" />}
          />
          <ul aria-label="الزبائن" className="-mx-1 flex max-h-64 flex-col gap-1 overflow-y-auto px-1">
            {found.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    onPicked({
                      id: c.id,
                      name: c.name,
                      creditLimitMinor: c.creditLimitMinor,
                      priceTier: c.priceTier,
                    })
                  }
                  className="flex min-h-14 w-full items-center gap-3 rounded-control px-2 py-1.5 text-start transition-colors duration-120 ease-standard hover:bg-surface-muted active:bg-surface-muted"
                >
                  <Avatar name={c.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold text-ink">{c.name}</span>
                    {c.phone ? (
                      <bdi dir="ltr" className="num self-start text-sm text-ink-muted">
                        {c.phone}
                      </bdi>
                    ) : null}
                  </span>
                  {c.creditLimitMinor !== null ? (
                    <span className="flex shrink-0 flex-col items-end text-xs text-ink-subtle">
                      حد الدين{' '}
                      <Money
                        minor={c.creditLimitMinor}
                        currency={settings.baseCurrency}
                        className="text-sm font-semibold text-ink-muted"
                      />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {found.length === 0 ? (
              <li className="py-4 text-center text-sm text-ink-muted">لا زبون بهذا الاسم أو الرقم.</li>
            ) : null}
          </ul>
          <Button
            variant="secondary"
            icon={<AddIcon />}
            onClick={() => {
              setAdding(true);
              setName(/\d/.test(search) ? '' : search);
              setPhone(/\d/.test(search) ? search : '');
            }}
          >
            زبون جديد
          </Button>
        </>
      )}
    </section>
  );
}
