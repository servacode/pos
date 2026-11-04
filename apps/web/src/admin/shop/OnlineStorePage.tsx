import { useCallback, useEffect, useState } from 'react';
import type {
  DeliveryArea,
  OnlineOrder,
  OnlineOrderStatus,
  OnlineStoreInput,
  OnlineStoreSettings,
} from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CartIcon,
  LinkIcon,
  Money,
  OnlineStoreIcon,
  OpenIcon,
  PageHeader,
  PhoneIcon,
  SegmentedControl,
  SettingsIcon,
  Switch,
  TextField,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { useMe } from '../../auth/useAuth';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';

const getSettings = () => apiFetch<OnlineStoreSettings>('/v1/online-store', { auth: true });
const saveSettings = (input: OnlineStoreInput) =>
  apiFetch<OnlineStoreSettings>('/v1/online-store', { method: 'PUT', body: input, auth: true });
const listOrders = (status: OnlineOrderStatus | 'all') =>
  apiFetch<{ items: OnlineOrder[] }>(`/v1/online-orders${status === 'all' ? '' : `?status=${status}`}`, {
    auth: true,
  });
const setStatus = (order: OnlineOrder, status: 'accepted' | 'rejected' | 'done') =>
  apiFetch<OnlineOrder>(`/v1/online-orders/${order.id}/status`, {
    method: 'POST',
    body: { status, version: order.version },
    auth: true,
  });

const STATUS_TEXT: Record<OnlineOrderStatus, string> = {
  pending: 'بانتظار المحل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  done: 'سُلّم',
};

/**
 * «المتجر الإلكتروني» (26 › المتجر الإلكتروني): the owner turns the shop on, picks its link and the
 * WhatsApp number orders go to; the orders it sends wait here to be accepted, rejected, delivered.
 */
export function OnlineStorePage() {
  const me = useMe();
  const permissions = new Set<string>(me.user.permissions);
  return (
    <AppShell>
      <title>المتجر الإلكتروني · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <PageHeader
          title="المتجر الإلكتروني"
          description="بضاعتك على رابط خاص بمحلك، والطلبات تصلك هنا."
          icon={OnlineStoreIcon}
        />
        <div className="flex flex-col gap-6">
          {permissions.has('settings.manage') ? <SettingsCard /> : null}
          {permissions.has('customers.view') ? <OrdersCard /> : null}
        </div>
      </div>
    </AppShell>
  );
}

/** «1,500» (Arabic digits too) to minor units of a currency with `decimals`; null while unusable */
export function minorOf(text: string, decimals: number): number | null {
  const clean = [...text.trim()]
    .map((ch) => {
      const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
      return arabic >= 0 ? String(arabic) : ch === '٫' ? '.' : ch;
    })
    .filter((ch) => ch !== ',' && ch !== ' ')
    .join('');
  if (clean === '') return 0;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10 ** decimals);
}

/**
 * «أجرة التوصيل»: one fee for every delivery, or a fee per area that the customer picks in the
 * cart. It is for the courier, on top of the pieces; not a sale of the store.
 */
function DeliveryFees({
  feeMinor,
  areas,
  onChange,
  error,
}: {
  feeMinor: number;
  areas: DeliveryArea[];
  onChange: (feeMinor: number, areas: DeliveryArea[]) => void;
  error?: string;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const decimals = CURRENCIES[base].decimals;
  const text = (minor: number) => (minor === 0 ? '' : String(minor / 10 ** decimals));
  const [flat, setFlat] = useState(text(feeMinor));
  const [rows, setRows] = useState(areas.map((a) => ({ name: a.name, fee: text(a.feeMinor) })));
  const push = (nextFlat: string, nextRows: { name: string; fee: string }[]) => {
    onChange(
      minorOf(nextFlat, decimals) ?? 0,
      nextRows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), feeMinor: minorOf(r.fee, decimals) ?? 0 })),
    );
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-control border border-line bg-canvas p-4">
      <legend className="px-1 font-semibold">أجرة التوصيل</legend>
      <p className="text-sm text-ink-muted">
        تُضاف على الطلب ويدفعها الزبون للمندوب، ولا تُسجَّل مبيعاً للمحل. أضف مناطق إن اختلفت الأجرة بينها.
      </p>
      {rows.length === 0 ? (
        <TextField
          label="الأجرة لكل توصيل"
          hint="فارغ: بلا أجرة"
          dir="ltr"
          inputMode="decimal"
          value={flat}
          onChange={(e) => {
            setFlat(e.target.value.slice(0, 12));
            push(e.target.value, rows);
          }}
          className="w-48"
        />
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <TextField
            label={`المنطقة ${i + 1}`}
            value={r.name}
            onChange={(e) => {
              const next = rows.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 40) } : x));
              setRows(next);
              push(flat, next);
            }}
          />
          <TextField
            label={`أجرة المنطقة ${i + 1}`}
            dir="ltr"
            inputMode="decimal"
            value={r.fee}
            onChange={(e) => {
              const next = rows.map((x, j) => (j === i ? { ...x, fee: e.target.value.slice(0, 12) } : x));
              setRows(next);
              push(flat, next);
            }}
            className="w-40"
          />
          <Button
            variant="ghost"
            onClick={() => {
              const next = rows.filter((_, j) => j !== i);
              setRows(next);
              push(flat, next);
            }}
          >
            احذف
          </Button>
        </div>
      ))}
      {error ? <p className="text-sm text-danger-ink">{error}</p> : null}
      <div>
        <Button variant="secondary" onClick={() => setRows([...rows, { name: '', fee: '' }])}>
          أضف منطقة
        </Button>
      </div>
    </fieldset>
  );
}

function SettingsCard() {
  const [form, setForm] = useState<OnlineStoreSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setForm)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (!form) return error ? <Alert tone="error">{error}</Alert> : null;
  const link = `${window.location.origin}/shop/${form.slug}`;
  const set = (patch: Partial<OnlineStoreSettings>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      setForm(await saveSettings(form));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="الإعداد" className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <CardHeader
          icon={LinkIcon}
          title="الرابط والتفعيل"
          description="شارك الرابط مع زبائنك على واتساب وفيسبوك."
          className="mb-0"
        />
        <Switch
          label="المتجر مفعّل"
          description="بضاعتك بصورها وأسعارها ومقاساتها المتوفرة على رابط خاص بمحلك، والطلب يصلك على واتساب."
          checked={form.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
        />
        <TextField
          label="رابط المتجر"
          hint={link}
          dir="ltr"
          value={form.slug}
          onChange={(e) => set({ slug: e.target.value.toLowerCase().slice(0, 40) })}
          error={fields.slug}
        />
        {form.enabled ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-control bg-brand-soft px-4 font-semibold text-brand-ink hover:underline"
          >
            <OpenIcon size={20} />
            <bdi dir="ltr" className="num">
              {link}
            </bdi>
          </a>
        ) : null}
      </Card>
      <Card className="flex flex-col gap-4">
        <CardHeader
          icon={PhoneIcon}
          title="الطلبات والتسليم"
          description="كيف يصلك الطلب، وكيف يستلمه الزبون."
          className="mb-0"
        />
        <SegmentedControl
          label="كيف يصلك الطلب"
          value={form.orderMode}
          onValueChange={(orderMode) => set({ orderMode })}
          options={[
            { value: 'whatsapp', label: 'رسالة واتساب' },
            { value: 'shop', label: 'من المتجر مباشرة' },
          ]}
        />
        <p className="text-sm text-ink-muted">
          {form.orderMode === 'shop'
            ? 'يتأكد الزبون من رقمه برمز يصله، ويصل الطلب هنا مباشرة. اقبله فتُحجز قطعه ويظهر على الكاشير ليبيعه.'
            : 'يُحفظ الطلب هنا ويفتح واتساب عند الزبون برسالة جاهزة إلى رقمك.'}
        </p>
        <TextField
          label={form.orderMode === 'shop' ? 'رقم واتساب المحل (اختياري)' : 'رقم واتساب الطلبات'}
          dir="ltr"
          inputMode="tel"
          value={form.whatsapp ?? ''}
          onChange={(e) => set({ whatsapp: e.target.value || null })}
          error={fields.whatsapp}
        />
        <Switch label="توصيل" checked={form.delivery} onCheckedChange={(delivery) => set({ delivery })} />
        {form.delivery ? (
          <DeliveryFees
            feeMinor={form.deliveryFeeMinor}
            areas={form.deliveryAreas}
            onChange={(deliveryFeeMinor, deliveryAreas) => set({ deliveryFeeMinor, deliveryAreas })}
            error={fields.deliveryAreas ?? fields.deliveryFeeMinor}
          />
        ) : null}
        <Switch label="استلام من المحل" checked={form.pickup} onCheckedChange={(pickup) => set({ pickup })} />
        {fields.delivery ? <p className="text-sm text-danger-ink">{fields.delivery}</p> : null}
      </Card>
      <Card className="flex flex-col gap-4">
        <CardHeader
          icon={SettingsIcon}
          title="العرض"
          description="ما يراه الزبون في أعلى المتجر وبين القطع."
          className="mb-0"
        />
        <TextField
          label="ملاحظة تظهر في أعلى المتجر (اختياري)"
          placeholder="التوصيل داخل المدينة خلال يوم"
          value={form.note ?? ''}
          onChange={(e) => set({ note: e.target.value.slice(0, 300) || null })}
        />
        <Switch
          label="اعرض القطع التي نفدت"
          description="تظهر بكلمة «نفد» ولا تُطلب. مطفأ: تختفي حتى تصل من جديد."
          checked={form.showOutOfStock}
          onCheckedChange={(showOutOfStock) => set({ showOutOfStock })}
        />
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? (
        <Alert tone="success">
          حُفظ.{' '}
          {form.enabled ? (
            <a href={link} target="_blank" rel="noreferrer" className="font-semibold underline">
              افتح المتجر
            </a>
          ) : (
            'المتجر مطفأ.'
          )}
        </Alert>
      ) : null}
      <div>
        <Button loading={saving} onClick={() => void save()}>
          احفظ
        </Button>
      </div>
    </section>
  );
}

function OrdersCard() {
  const [status, setFilter] = useState<OnlineOrderStatus | 'all'>('pending');
  const [items, setItems] = useState<OnlineOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    listOrders(status)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);

  async function move(order: OnlineOrder, next: 'accepted' | 'rejected' | 'done') {
    try {
      await setStatus(order, next);
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        icon={CartIcon}
        title="الطلبات"
        description="اقبل الطلب فتُحجز قطعه، أو ارفضه."
        className="mb-0"
      />
      <SegmentedControl
        label="الحالة"
        value={status}
        onValueChange={setFilter}
        options={[
          { value: 'pending', label: 'بانتظار المحل' },
          { value: 'accepted', label: 'مقبولة' },
          { value: 'all', label: 'الكل' },
        ]}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {items && items.length === 0 ? (
        <p className="rounded-control border border-dashed border-line px-6 py-8 text-center text-ink-muted">
          لا طلبات هنا.
        </p>
      ) : null}
      <ul aria-label="طلبات المتجر" className="flex flex-col gap-3">
        {(items ?? []).map((o) => (
          <li
            key={o.id}
            aria-label={`الطلب ${o.number}`}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-e1"
          >
            <div className="flex flex-wrap items-center gap-2">
              <bdi dir="ltr" className="num font-bold">
                {o.number}
              </bdi>
              <Badge
                tone={o.status === 'pending' ? 'warning' : o.status === 'rejected' ? 'danger' : 'success'}
              >
                {STATUS_TEXT[o.status]}
              </Badge>
              {o.source === 'shop' ? <Badge tone="neutral">رقم مؤكَّد</Badge> : null}
              {o.source === 'hold' ? (
                <Badge tone="neutral">حجز في المحل{o.depositCode ? ` · عربون ${o.depositCode}` : ''}</Badge>
              ) : null}
              <span className="flex-1" />
              <Money minor={o.totalMinor} currency={o.currency} className="font-bold" />
            </div>
            <p className="text-sm text-ink">
              {o.customerName} ·{' '}
              <a
                href={`https://wa.me/${o.phone.replace('+', '')}`}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="num underline"
              >
                {o.phone}
              </a>{' '}
              · {o.fulfilment === 'delivery' ? `توصيل إلى ${o.address ?? ''}` : 'استلام من المحل'}
              {o.deliveryFeeMinor > 0 ? (
                <>
                  {' '}
                  · أجرة التوصيل{o.deliveryArea ? ` (${o.deliveryArea})` : ''}{' '}
                  <Money minor={o.deliveryFeeMinor} currency={o.currency} /> للمندوب
                </>
              ) : null}
            </p>
            <ul className="text-sm text-ink-muted">
              {o.lines.map((l) => (
                <li key={l.variantId}>
                  {l.name}
                  {l.label ? ` (${l.label})` : ''} × {l.qty}
                </li>
              ))}
            </ul>
            {o.note ? <p className="text-sm">ملاحظة: {o.note}</p> : null}
            <div className="flex flex-wrap gap-2">
              {o.status === 'pending' ? (
                <>
                  <Button size="sm" onClick={() => void move(o, 'accepted')}>
                    اقبل
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void move(o, 'rejected')}>
                    ارفض
                  </Button>
                </>
              ) : o.status === 'accepted' ? (
                <>
                  <span className="self-center text-sm text-ink-muted">
                    قطعه محجوزة، ويبيعه الكاشير من «طلبات المتجر».
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void move(o, 'done')}>
                    سُلّم دون بيع على الكاشير
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
