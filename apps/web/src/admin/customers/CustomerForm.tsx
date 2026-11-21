import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  CUSTOMER_KIND_LABELS,
  CUSTOMER_KINDS,
  normalizeArabic,
  normalizeContactPhone,
  toLatinDigits,
  toMinor,
  type CustomerDetail,
  type CurrencyCode,
  type CustomerKind,
  type CustomerGroup,
  type CustomerListItem,
  type RegionRow,
  type SectorKey,
} from '@serva/core';
import { Alert, Button, Select, Switch, TextField } from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { storeSells } from '../../lib/sectors';
import { approveCustomer, listRegions } from '../distribution/api';
import { createCustomer, listCustomers, listGroups, updateCustomer } from './api';
import './customers.css';

/** The shops that sell to clinics, hospitals and offices: only they type a customer by kind */
export const KIND_SECTORS: readonly SectorKey[] = [
  'medical_supplies',
  'pharmacy',
  'wholesale',
  'building_materials',
  'general',
];

/** An amount typed in the base currency («50000», «50,000», «٥٠٠٠٠», «0.5») to minor units; '' is no limit */
export function limitOf(text: string, base: CurrencyCode): number | null | 'bad' {
  if (!text.trim()) return null;
  try {
    const minor = toMinor(text, base);
    return minor >= 0 ? minor : 'bad';
  } catch {
    return 'bad';
  }
}

/** A coordinate typed in any digits: NaN when it is not a number */
export function coordinate(text: string): number | null {
  const clean = toLatinDigits(text).trim().replace('٫', '.').replace(',', '.');
  if (!clean) return null;
  return /^-?\d{1,3}(\.\d{1,10})?$/.test(clean) ? Number(clean) : Number.NaN;
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
    <div className="cx-sec">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The customers that share the typed name or phone, asked of the server once the typing pauses (the
 * list is paged, so no page holds everyone). `existing` is what the caller already knows.
 */
function useTwins(
  existing: readonly CustomerListItem[],
  name: string,
  phone: string,
  selfId?: string,
): CustomerListItem[] {
  const [found, setFound] = useState<CustomerListItem[]>([]);
  const wanted = useRef('');
  useEffect(() => {
    const byName = normalizeArabic(name).length >= 2 ? name.trim() : '';
    const byPhone = phone.trim() && normalizeContactPhone(phone) ? phone.trim() : '';
    wanted.current = `${byName}|${byPhone}`;
    if (!byName && !byPhone) {
      setFound([]);
      return;
    }
    const mine = wanted.current;
    const timer = setTimeout(() => {
      void Promise.all([
        byName ? listCustomers(byName).catch(() => null) : null,
        byPhone ? listCustomers(byPhone).catch(() => null) : null,
      ]).then(([a, b]) => {
        if (wanted.current !== mine) return;
        const seen = new Map<string, CustomerListItem>();
        for (const c of [...(a?.items ?? []), ...(b?.items ?? [])]) seen.set(c.id, c);
        setFound([...seen.values()]);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [name, phone]);
  return sameCustomers([...existing, ...found], name, phone, selfId);
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
  const seen = new Set<string>();
  return existing.filter(
    (c) =>
      c.id !== selfId &&
      !seen.has(c.id) &&
      (seen.add(c.id), true) &&
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
  const me = useMe();
  // A clothing or grocery shop does not see «عيادة» or «مشفى»; a customer already typed keeps its kind
  const asksKind = storeSells(me.tenant.sectors, KIND_SECTORS) || !!customer?.kind;
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
  const [kind, setKind] = useState<CustomerKind | ''>(customer?.kind ?? '');
  const [contactName, setContactName] = useState(customer?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(customer?.contactPhone ?? '');
  // «التوزيع»: the region and the shop's place, for a store whose plan has reps
  const distribution = me.subscription.repsEnabled === true && me.user.permissions.includes('routes.manage');
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [regionId, setRegionId] = useState(customer?.regionId ?? '');
  const [lat, setLat] = useState(typeof customer?.lat === 'number' ? String(customer.lat) : '');
  const [lng, setLng] = useState(typeof customer?.lng === 'number' ? String(customer.lng) : '');
  useEffect(() => {
    if (!distribution) return;
    listRegions()
      .then((r) => setRegions(r.filter((x) => x.isActive || x.id === customer?.regionId)))
      .catch(() => setRegions([]));
  }, [distribution, customer?.regionId]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // «المجموعة» and the birthday
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [groupId, setGroupId] = useState(customer?.groupId ?? '');
  const [birthDate, setBirthDate] = useState(customer?.birthDate ?? '');
  useEffect(() => {
    listGroups()
      .then((g) => setGroups(g.filter((x) => !x.archived || x.id === customer?.groupId)))
      .catch(() => setGroups([]));
  }, [customer?.groupId]);
  /** The server said another customer has this phone: the owner may save anyway */
  const [twinPhone, setTwinPhone] = useState(false);

  const same = useTwins(existing, name, phone, customer?.id);
  const base = me.settings.baseCurrency;
  const unit = base === 'SYP' ? 'بالليرة' : `(${base})`;

  async function save(confirmDuplicate = false) {
    // Everything that can be wrong with what was typed is said before anything is sent
    const creditLimitMinor = limitOf(limit, base);
    if (creditLimitMinor === 'bad') {
      setFields({ creditLimitMinor: 'اكتب الحد أرقاماً، أو اتركه فارغاً بلا حد' });
      return;
    }
    const place = distribution
      ? { regionId: regionId || null, lat: coordinate(lat), lng: coordinate(lng) }
      : {};
    if (distribution && (Number.isNaN(place.lat) || Number.isNaN(place.lng))) {
      setFields({ lat: 'اكتب الموقع أرقاماً، مثل 33.51 و 36.29' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const input = {
      ...place,
      name,
      phone,
      taxNumber,
      address,
      notes,
      creditLimitMinor,
      priceTier: wholesale ? ('wholesale' as const) : ('retail' as const),
      noMessages,
      kind: kind || null,
      contactName,
      contactPhone,
      groupId: groupId || null,
      birthDate: birthDate || null,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
    };
    try {
      onSaved(customer ? await updateCustomer(customer.id, input) : await createCustomer(input));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.fields?.phone) {
        setTwinPhone(true);
        setFields({ phone: e.fields.phone });
        setError(e.message);
      } else if (e instanceof ApiError && e.fields) setFields(e.fields);
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
      <section className="sx-card">
        <div className="sx-card-h">
          <h2>{customer ? 'بيانات الزبون' : 'زبون جديد'}</h2>
          <span className="sx-aside">
            {customer ? 'عدّل ما تغيّر، ثم احفظ.' : 'الاسم وحده يكفي للبدء، والباقي تضيفه حين تحتاجه.'}
          </span>
        </div>
        <div className="cx-form">
          {error ? (
            <Alert tone={twinPhone ? 'warning' : 'error'}>
              {error}
              {twinPhone ? (
                <span className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={saving} onClick={() => void save(true)}>
                    احفظ رغم ذلك
                  </Button>
                </span>
              ) : null}
            </Alert>
          ) : null}
          {distribution && customer?.approvalStatus === 'pending' ? (
            <Alert tone="warning" title="زبون أضافه مندوب وينتظر موافقتك">
              <p>حتى توافق عليه يبيعه المندوب نقداً فقط.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['approved', 'rejected'] as const).map((status) => (
                  <Button
                    key={status}
                    variant={status === 'approved' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() =>
                      void approveCustomer(customer.id, { status })
                        .then(onSaved)
                        .catch((e: unknown) => setError(errorMessage(e)))
                    }
                  >
                    {status === 'approved' ? 'وافق' : 'ارفض'}
                  </Button>
                ))}
              </div>
            </Alert>
          ) : null}
          <FormSection title="البيانات" description="كيف تعرفه وتصل إليه.">
            <div className="cx-grid2">
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
                onChange={(e) => {
                  setPhone(e.target.value);
                  setTwinPhone(false);
                }}
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
              <Select
                label="المجموعة"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                error={fields.groupId}
              >
                <option value="">بلا مجموعة</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.discountBps > 0 ? ` (خصم ${g.discountBps / 100}%)` : ''}
                  </option>
                ))}
              </Select>
              <DateField
                label="تاريخ الميلاد"
                value={birthDate}
                onChange={setBirthDate}
                error={fields.birthDate}
              />
              {asksKind ? (
                <Select
                  label="نوع الزبون"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CustomerKind | '')}
                  error={fields.kind}
                >
                  <option value="">غير محدد</option>
                  {CUSTOMER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CUSTOMER_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              ) : null}
              <TextField
                label="المسؤول للتواصل"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                error={fields.contactName}
              />
              <TextField
                label="جوال المسؤول"
                inputMode="tel"
                dir="ltr"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                error={fields.contactPhone}
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
          {distribution ? (
            <FormSection title="التوزيع" description="منطقة الزبون وموقع محله لخط سير المندوب.">
              <div className="cx-grid3">
                <Select
                  label="المنطقة"
                  value={regionId}
                  onChange={(e) => setRegionId(e.target.value)}
                  error={fields.regionId}
                >
                  <option value="">بلا منطقة</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <TextField
                  label="خط العرض"
                  hint="اختياري"
                  inputMode="decimal"
                  dir="ltr"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  error={fields.lat}
                />
                <TextField
                  label="خط الطول"
                  hint="اختياري"
                  inputMode="decimal"
                  dir="ltr"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  error={fields.lng}
                />
              </div>
            </FormSection>
          ) : null}
          <FormSection title="البيع بالآجل" description="حدّ دينه، والسعر الذي يشتري به.">
            <div className="flex flex-col gap-4">
              <TextField
                label={`حد الدين ${unit}`}
                hint="فارغ: بلا حد. البيع فوق الحد يُقبل ويظهر تنبيه."
                inputMode="decimal"
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
          <div className="cx-actions">
            <Button variant="secondary" onClick={onCancel}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              احفظ
            </Button>
          </div>
        </div>
      </section>
    </form>
  );
}
