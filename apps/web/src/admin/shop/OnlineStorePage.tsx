import { useCallback, useEffect, useState } from 'react';
import type { OnlineOrder, OnlineOrderStatus, OnlineStoreInput, OnlineStoreSettings } from '@serva/core';
import { Alert, Badge, Button, Card, Money, SegmentedControl, Switch, TextField } from '@serva/ui';
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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">المتجر الإلكتروني</h1>
        {permissions.has('settings.manage') ? <SettingsCard /> : null}
        {permissions.has('customers.view') ? <OrdersCard /> : null}
      </div>
    </AppShell>
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
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-ink">الإعداد</h2>
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
      <Switch label="استلام من المحل" checked={form.pickup} onCheckedChange={(pickup) => set({ pickup })} />
      {fields.delivery ? <p className="text-sm text-danger-ink">{fields.delivery}</p> : null}
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
    </Card>
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
      <h2 className="text-xl font-bold text-ink">الطلبات</h2>
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
      {items && items.length === 0 ? <p className="text-ink-muted">لا طلبات هنا.</p> : null}
      <ul aria-label="طلبات المتجر" className="flex flex-col gap-3">
        {(items ?? []).map((o) => (
          <li
            key={o.id}
            aria-label={`الطلب ${o.number}`}
            className="flex flex-col gap-2 rounded-control border border-line p-3"
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
