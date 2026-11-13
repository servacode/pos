import { useCallback, useEffect, useId, useState } from 'react';
import type {
  DeliveryArea,
  OnlineOrder,
  OnlineOrderStatus,
  OnlineStoreInput,
  OnlineStoreSettings,
} from '@serva/core';
import { CURRENCIES } from '@serva/core/currencies';
import { normalizePhone } from '@serva/core/phone';
import {
  AddIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CartIcon,
  CheckIcon,
  ChoiceCard,
  DeleteIcon,
  EmptyState,
  EyeIcon,
  FieldError,
  FieldGroup,
  IconButton,
  IconChip,
  InboxIcon,
  LinkIcon,
  Money,
  PageHeader,
  SegmentedControl,
  SendIcon,
  SkeletonText,
  StoreIcon,
  Switch,
  TextField,
  Tooltip,
  TruckIcon,
  type BadgeTone,
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
  cancel_requested: 'طلب الزبون الإلغاء',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  done: 'سُلّم',
};

const STATUS_TONE: Record<OnlineOrderStatus, BadgeTone> = {
  pending: 'warning',
  cancel_requested: 'danger',
  accepted: 'success',
  rejected: 'danger',
  done: 'success',
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
      <title>المتجر الإلكتروني · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <PageHeader
          title="المتجر الإلكتروني"
          description="بضاعتك بصورها وأسعارها على رابط خاص بمحلك، والطلبات تصلك هنا."
        />
        {permissions.has('settings.manage') ? <SettingsCard /> : null}
        {permissions.has('customers.view') ? <OrdersCard /> : null}
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

/** The currency symbol at the end of a fee field, in the subtle ink the field gives its units. */
function Unit({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="me-3 shrink-0 text-sm whitespace-nowrap select-none">
      {children}
    </span>
  );
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
  const titleId = useId();
  const hintId = `${titleId}-hint`;
  const errorId = `${titleId}-error`;
  const base = me.settings.baseCurrency;
  const decimals = CURRENCIES[base].decimals;
  const unit = CURRENCIES[base].symbolAr;
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
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={error ? `${hintId} ${errorId}` : hintId}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <p id={titleId} className="text-sm font-semibold text-ink">
          أجرة التوصيل
        </p>
        <p id={hintId} className="text-sm text-ink-muted">
          تُضاف على الطلب ويدفعها الزبون للمندوب، ولا تُسجَّل مبيعاً للمحل. أضف مناطق إن اختلفت الأجرة بينها.
        </p>
      </div>
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
          endAdornment={<Unit>{unit}</Unit>}
          inputClassName="num"
          className="sm:max-w-60"
        />
      ) : (
        <div className="overflow-hidden rounded-control border border-line bg-surface">
          {/* The column heads; each field keeps its own name for screen readers. */}
          <div
            aria-hidden="true"
            className="flex items-center gap-2 border-b border-line bg-surface-muted/60 px-3 py-2 text-xs font-semibold text-ink-subtle sm:gap-3"
          >
            <span className="min-w-0 flex-1">المنطقة</span>
            <span className="w-24 sm:w-40">الأجرة</span>
            <span className="w-9 pointer-coarse:w-12" />
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 sm:gap-3">
                <TextField
                  label={`المنطقة ${i + 1}`}
                  hideLabel
                  value={r.name}
                  onChange={(e) => {
                    const next = rows.map((x, j) =>
                      j === i ? { ...x, name: e.target.value.slice(0, 40) } : x,
                    );
                    setRows(next);
                    push(flat, next);
                  }}
                  className="min-w-0 flex-1"
                />
                <TextField
                  label={`أجرة المنطقة ${i + 1}`}
                  hideLabel
                  dir="ltr"
                  inputMode="decimal"
                  value={r.fee}
                  onChange={(e) => {
                    const next = rows.map((x, j) =>
                      j === i ? { ...x, fee: e.target.value.slice(0, 12) } : x,
                    );
                    setRows(next);
                    push(flat, next);
                  }}
                  endAdornment={<Unit>{unit}</Unit>}
                  inputClassName="num"
                  className="w-24 shrink-0 sm:w-40"
                />
                <Tooltip content="احذف المنطقة">
                  <IconButton
                    label={`احذف المنطقة ${i + 1}`}
                    icon={<DeleteIcon />}
                    size="sm"
                    onClick={() => {
                      const next = rows.filter((_, j) => j !== i);
                      setRows(next);
                      push(flat, next);
                    }}
                  />
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<AddIcon size={16} />}
          onClick={() => setRows([...rows, { name: '', fee: '' }])}
        >
          أضف منطقة
        </Button>
      </div>
    </div>
  );
}

/** The shop's link in full, with a button that copies it. */
function ShopLink({ id, link }: { id: string; link: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-surface-muted py-1 ps-3 pe-1">
      <LinkIcon size={16} className="text-ink-subtle" />
      <bdi id={id} dir="ltr" className="block min-w-0 flex-1 truncate text-end text-sm text-ink-muted">
        {link}
      </bdi>
      <Button
        size="xs"
        variant="ghost"
        icon={copied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(link)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? 'نُسخ الرابط' : 'انسخ الرابط'}
      </Button>
    </div>
  );
}

/** What the customer sees at the top of the shop, drawn from the settings as they are typed. */
function ShopPreview({
  store,
  settings,
  link,
}: {
  store: string;
  settings: OnlineStoreSettings;
  link: string;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader icon={<EyeIcon />} title="معاينة" description="هكذا يبدو أعلى متجرك للزبون." />
      <div aria-hidden="true" className="overflow-hidden rounded-card border border-line bg-canvas">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-line-control/40" />
            <span className="size-2 rounded-full bg-line-control/40" />
            <span className="size-2 rounded-full bg-line-control/40" />
          </span>
          <bdi
            dir="ltr"
            className="block min-w-0 flex-1 truncate rounded-small bg-surface-muted px-2 py-0.5 text-xs text-ink-subtle"
          >
            {link.replace(/^https?:\/\//, '')}
          </bdi>
        </div>
        <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5">
          <Avatar name={store} size="sm" />
          <span className="min-w-0 flex-1 truncate font-bold text-ink">{store}</span>
          <span className="inline-flex items-center gap-1.5 rounded-control bg-brand px-3 py-1 text-xs font-semibold text-on-brand">
            <CartIcon size={16} />
            السلة
          </span>
        </div>
        <div className="flex flex-col gap-3 p-3">
          {settings.enabled ? null : (
            <p className="rounded-small bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-ink">
              المتجر مطفأ: لا يراه الزبائن الآن.
            </p>
          )}
          {settings.note ? (
            <p className="rounded-small border border-line bg-surface px-3 py-2 text-xs text-ink">
              {settings.note}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {settings.delivery ? <Badge tone="brand">توصيل</Badge> : null}
            {settings.pickup ? <Badge tone="neutral">استلام من المحل</Badge> : null}
            <Badge tone="neutral">
              {settings.orderMode === 'shop' ? 'الطلب من المتجر' : 'الطلب على واتساب'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((tile) => (
              <span
                key={tile}
                className="flex flex-col gap-2 rounded-small border border-line bg-surface p-2"
              >
                <span className="aspect-[4/3] rounded-small bg-surface-muted" />
                <span className="h-2 w-3/4 rounded-full bg-surface-muted" />
                <span className="h-2 w-1/3 rounded-full bg-brand-soft" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SettingsCard() {
  const me = useMe();
  const linkId = useId();
  const [form, setForm] = useState<OnlineStoreSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // What the server holds, to tell an unsaved change from none
  const [kept, setKept] = useState('');

  useEffect(() => {
    getSettings()
      .then((s) => {
        setForm(s);
        setKept(JSON.stringify(s));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  // «حُفظ» stays a few seconds, then the save bar leaves until the next change
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 6_000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!form) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <div aria-busy="true" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Card>
          <SkeletonText lines={6} />
        </Card>
        <Card>
          <SkeletonText lines={4} />
        </Card>
      </div>
    );
  }
  const link = `${window.location.origin}/shop/${form.slug}`;
  const dirty = JSON.stringify(form) !== kept;
  // The number is checked as it is typed: letters are an error, not something silently dropped
  const whatsappText = form.whatsapp ?? '';
  const whatsappError =
    whatsappText.trim() && !normalizePhone(whatsappText)
      ? 'رقم غير صحيح: اكتب أرقاماً فقط، مثل 0933123456'
      : undefined;
  const set = (patch: Partial<OnlineStoreSettings>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };

  async function save() {
    if (!form || whatsappError) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const done = await saveSettings(form);
      setForm(done);
      setKept(JSON.stringify(done));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="الإعداد" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader
            icon={<StoreIcon />}
            title="حالة المتجر"
            description="شغّله، واختر الرابط الذي ترسله لزبائنك."
          />
          <div className="flex flex-col gap-5">
            <Switch
              label="المتجر مفعّل"
              description="بضاعتك بصورها وأسعارها ومقاساتها المتوفرة على رابط خاص بمحلك، والطلب يصلك على واتساب."
              checked={form.enabled}
              onCheckedChange={(enabled) => set({ enabled })}
            />
            <div className="flex flex-col gap-2 border-t border-line pt-5">
              <TextField
                label="رابط المتجر"
                dir="ltr"
                value={form.slug}
                onChange={(e) => set({ slug: e.target.value.toLowerCase().slice(0, 40) })}
                error={fields.slug}
                {...(fields.slug ? {} : { 'aria-describedby': linkId })}
              />
              <ShopLink id={linkId} link={link} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<InboxIcon />}
            title="استقبال الطلبات"
            description="كيف يصلك طلب الزبون، وعلى أي رقم."
          />
          <div className="flex flex-col gap-5">
            <FieldGroup legend="كيف يصلك الطلب">
              <div className="grid gap-3 md:grid-cols-2">
                <ChoiceCard
                  name="order-mode"
                  value="whatsapp"
                  title="رسالة واتساب"
                  description="يُحفظ الطلب هنا ويفتح واتساب عند الزبون برسالة جاهزة إلى رقمك."
                  leading={<SendIcon />}
                  checked={form.orderMode === 'whatsapp'}
                  onChange={() => set({ orderMode: 'whatsapp' })}
                />
                <ChoiceCard
                  name="order-mode"
                  value="shop"
                  title="من المتجر مباشرة"
                  description="يتأكد الزبون من رقمه برمز يصله، ويصل الطلب هنا مباشرة. اقبله فتُحجز قطعه ويظهر على الكاشير ليبيعه."
                  leading={<StoreIcon />}
                  checked={form.orderMode === 'shop'}
                  onChange={() => set({ orderMode: 'shop' })}
                />
              </div>
            </FieldGroup>
            <TextField
              label={form.orderMode === 'shop' ? 'رقم واتساب المحل (اختياري)' : 'رقم واتساب الطلبات'}
              dir="ltr"
              inputMode="tel"
              value={form.whatsapp ?? ''}
              onChange={(e) => set({ whatsapp: e.target.value || null })}
              error={fields.whatsapp ?? whatsappError}
              inputClassName="num"
              className="sm:max-w-sm"
            />
          </div>
        </Card>
        <Card>
          <CardHeader icon={<TruckIcon />} title="التوصيل والاستلام" description="كيف يستلم الزبون طلبه." />
          <div className="flex flex-col gap-4">
            <Switch
              label="توصيل"
              description="يوصل المحل الطلب إلى عنوان الزبون."
              checked={form.delivery}
              onCheckedChange={(delivery) => set({ delivery })}
            />
            {form.delivery ? (
              <div className="sm:rounded-card sm:border sm:border-line sm:bg-canvas sm:p-4">
                <DeliveryFees
                  feeMinor={form.deliveryFeeMinor}
                  areas={form.deliveryAreas}
                  onChange={(deliveryFeeMinor, deliveryAreas) => set({ deliveryFeeMinor, deliveryAreas })}
                  error={fields.deliveryAreas ?? fields.deliveryFeeMinor}
                />
              </div>
            ) : null}
            <div className="border-t border-line pt-4">
              <Switch
                label="استلام من المحل"
                description="يأتي الزبون ويأخذ طلبه من المحل."
                checked={form.pickup}
                onCheckedChange={(pickup) => set({ pickup })}
              />
            </div>
            {fields.delivery ? <FieldError>{fields.delivery}</FieldError> : null}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<EyeIcon />} title="واجهة المتجر" description="ما يظهر للزبون فوق بضاعتك." />
          <div className="flex flex-col gap-5">
            <TextField
              label="ملاحظة تظهر في أعلى المتجر (اختياري)"
              placeholder="التوصيل داخل المدينة خلال يوم"
              value={form.note ?? ''}
              onChange={(e) => set({ note: e.target.value.slice(0, 300) || null })}
            />
            <div className="border-t border-line pt-4">
              <Switch
                label="اعرض القطع التي نفدت"
                description="تظهر بكلمة «نفد» ولا تُطلب. مطفأ: تختفي حتى تصل من جديد."
                checked={form.showOutOfStock}
                onCheckedChange={(showOutOfStock) => set({ showOutOfStock })}
              />
            </div>
            <div className="border-t border-line pt-4">
              <Switch
                label="اعرض الأسعار في المتجر الإلكتروني"
                description="مطفأ: يرى الزبون القطع والصور دون سعر، ويصلك الطلب استفساراً تؤكد له سعره."
                checked={form.showPrices}
                onCheckedChange={(showPrices) => set({ showPrices })}
              />
            </div>
          </div>
        </Card>
        {dirty || saved || error ? (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-e2 sm:ps-5">
            <div className="min-w-0 flex-1 basis-60">
              {error ? (
                <Alert tone="error">{error}</Alert>
              ) : saved ? (
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
              ) : (
                <p className="text-sm text-ink-muted">التغييرات لا تصل إلى المتجر حتى تحفظها.</p>
              )}
            </div>
            {dirty ? (
              <Button loading={saving} disabled={Boolean(whatsappError)} onClick={() => void save()}>
                احفظ
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <aside className="lg:sticky lg:top-24">
        <ShopPreview store={me.tenant.name} settings={form} link={link} />
      </aside>
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

  // The orders being decided: their buttons are off until the answer, so a double click is one request
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  async function move(order: OnlineOrder, next: 'accepted' | 'rejected' | 'done') {
    if (busy.has(order.id)) return;
    setBusy((b) => new Set(b).add(order.id));
    try {
      await setStatus(order, next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy((b) => {
        const rest = new Set(b);
        rest.delete(order.id);
        return rest;
      });
    }
    load();
  }

  return (
    <section aria-label="الطلبات" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-ink">الطلبات</h2>
          <p className="text-sm text-ink-muted">ما يطلبه الزبائن من المتجر: اقبله أو ارفضه.</p>
        </div>
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
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {items === null && !error ? (
        <Card aria-busy="true">
          <SkeletonText lines={4} />
        </Card>
      ) : null}
      {items && items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="لا طلبات هنا."
          description="كل طلب يرسله زبون من المتجر يظهر هنا لتقبله أو ترفضه."
        />
      ) : null}
      {items && items.length > 0 ? (
        <ul aria-label="طلبات المتجر" className="grid gap-4 xl:grid-cols-2">
          {items.map((o) => (
            <li
              key={o.id}
              aria-label={`الطلب ${o.number}`}
              className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1"
            >
              <div className="flex flex-wrap items-start gap-3">
                <IconChip
                  tone={o.status === 'pending' || o.status === 'cancel_requested' ? 'warning' : 'brand'}
                >
                  {o.fulfilment === 'delivery' ? <TruckIcon /> : <StoreIcon />}
                </IconChip>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <bdi dir="ltr" className="num font-bold text-ink">
                      {o.number}
                    </bdi>
                    <Badge tone={STATUS_TONE[o.status]}>{STATUS_TEXT[o.status]}</Badge>
                    {o.source === 'shop' ? <Badge tone="neutral">رقم مؤكَّد</Badge> : null}
                    {o.source === 'hold' ? (
                      <Badge tone="neutral">
                        حجز في المحل{o.depositCode ? ` · عربون ${o.depositCode}` : ''}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {o.customerName} ·{' '}
                    <a
                      href={`https://wa.me/${o.phone.replace('+', '')}`}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="num font-semibold text-brand-ink underline decoration-transparent underline-offset-4 hover:decoration-current"
                    >
                      {o.phone}
                    </a>
                  </p>
                </div>
                <Money minor={o.totalMinor} currency={o.currency} className="text-lg font-bold text-ink" />
              </div>
              <p className="text-sm text-ink">
                {o.fulfilment === 'delivery' ? `توصيل إلى ${o.address ?? ''}` : 'استلام من المحل'}
                {o.deliveryFeeMinor > 0 ? (
                  <span className="text-ink-muted">
                    {' '}
                    · أجرة التوصيل{o.deliveryArea ? ` (${o.deliveryArea})` : ''}{' '}
                    <Money minor={o.deliveryFeeMinor} currency={o.currency} /> للمندوب
                  </span>
                ) : null}
              </p>
              <ul className="flex flex-col divide-y divide-line rounded-control bg-surface-muted/60 px-3 text-sm">
                {o.lines.map((l) => (
                  <li key={l.variantId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 text-ink">
                      {l.name}
                      {l.label ? ` (${l.label})` : ''}
                    </span>{' '}
                    <span className="num shrink-0 text-ink-muted">× {l.qty}</span>
                  </li>
                ))}
              </ul>
              {o.note ? (
                <p className="text-sm text-ink-muted">
                  <span className="font-semibold text-ink">ملاحظة: </span>
                  {o.note}
                </p>
              ) : null}
              {o.status === 'pending' || o.status === 'cancel_requested' || o.status === 'accepted' ? (
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  {o.status === 'cancel_requested' ? (
                    <>
                      <span className="min-w-0 basis-full text-sm font-semibold text-danger-ink">
                        الزبون يطلب إلغاء هذا الطلب.
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy.has(o.id)}
                        disabled={busy.has(o.id)}
                        onClick={() => void move(o, 'rejected')}
                      >
                        وافق على الإلغاء
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy.has(o.id)}
                        onClick={() => void move(o, 'accepted')}
                      >
                        أبقِ الطلب واقبله
                      </Button>
                    </>
                  ) : o.status === 'pending' ? (
                    <>
                      <Button
                        size="sm"
                        icon={<CheckIcon size={16} />}
                        loading={busy.has(o.id)}
                        disabled={busy.has(o.id)}
                        onClick={() => void move(o, 'accepted')}
                      >
                        اقبل
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy.has(o.id)}
                        onClick={() => void move(o, 'rejected')}
                      >
                        ارفض
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-sm text-ink-muted">
                        قطعه محجوزة، ويبيعه الكاشير من «طلبات المتجر».
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy.has(o.id)}
                        onClick={() => void move(o, 'done')}
                      >
                        سُلّم دون بيع على الكاشير
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
