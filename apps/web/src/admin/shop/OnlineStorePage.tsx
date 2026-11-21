import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  DeliveryArea,
  InventoryResponse,
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
  SegmentedControl,
  SendIcon,
  Skeleton,
  SkeletonText,
  StoreIcon,
  Switch,
  TextField,
  Tooltip,
  TruckIcon,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { useMe } from '../../auth/useAuth';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { zonedDateTime } from '../../lib/dates';
import { Pager, type PagerState } from '../pager';
import { Amt, PageTop, SalesPage, StatusPill, type BadgeKind } from '../sales/ui';
import { CodCard, DeliveryActions } from './DeliveryPanel';
import { ShopLook } from './ShopLook';

const getSettings = () => apiFetch<OnlineStoreSettings>('/v1/online-store', { auth: true });
const saveSettings = (input: OnlineStoreInput) =>
  apiFetch<OnlineStoreSettings>('/v1/online-store', { method: 'PUT', body: input, auth: true });
/** Orders a page: the first page keeps the plain address, the next ones carry the cursor */
const listOrders = (status: OnlineOrderStatus | 'all', cursor: string | null = null) => {
  const query = [status === 'all' ? '' : `status=${status}`, cursor ? `cursor=${cursor}` : '']
    .filter(Boolean)
    .join('&');
  return apiFetch<{
    items: OnlineOrder[];
    nextCursor?: string | null;
    counts?: { pending: number; accepted: number; all: number };
  }>(`/v1/online-orders${query ? `?${query}` : ''}`, { auth: true }).then((r) => ({
    items: r.items,
    nextCursor: r.nextCursor ?? null,
    counts: r.counts ?? null,
  }));
};
const getStock = () => apiFetch<InventoryResponse>('/v1/inventory', { auth: true });
const setStatus = (order: OnlineOrder, status: 'accepted' | 'rejected' | 'done', force = false) =>
  apiFetch<OnlineOrder>(`/v1/online-orders/${order.id}/status`, {
    method: 'POST',
    body: { status, version: order.version, ...(force ? { force: true } : {}) },
    auth: true,
  });

const STATUS_TEXT: Record<OnlineOrderStatus, string> = {
  pending: 'بانتظار المحل',
  cancel_requested: 'طلب الزبون الإلغاء',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  done: 'سُلّم',
};

/** An order waiting for the store is the exception worth a fill; a decided one is quiet */
const STATUS_KIND: Record<OnlineOrderStatus, BadgeKind> = {
  pending: 'open',
  cancel_requested: 'danger',
  accepted: 'ok',
  rejected: 'danger',
  done: 'ok',
};

/**
 * «المتجر الإلكتروني» (26 › المتجر الإلكتروني): the owner turns the shop on, picks its link and the
 * WhatsApp number orders go to; the orders it sends wait here to be accepted, rejected, delivered.
 */
export function OnlineStorePage() {
  const me = useMe();
  const permissions = new Set<string>(me.user.permissions);
  const canSettings = permissions.has('settings.manage');
  const canOrders = permissions.has('customers.view');
  // Accepting, delivering and the couriers' cash are a manager's (the server asks for the same)
  const canDecide = permissions.has('customers.manage');
  const both = canSettings && canOrders;
  // The orders wait here every day, the settings once: orders come first, settings behind a tab
  const [tab, setTab] = useState<'orders' | 'settings'>('orders');
  const [settingsSeen, setSettingsSeen] = useState(false);
  return (
    <AppShell>
      <title>المتجر الإلكتروني · SERVA</title>
      <SalesPage className="mx-auto w-full max-w-6xl">
        <PageTop
          title="المتجر الإلكتروني"
          subtitle="بضاعتك بصورها وأسعارها على رابط خاص بمحلك، والطلبات تصلك هنا."
        />
        {both ? (
          <SegmentedControl
            label="القسم"
            value={tab}
            onValueChange={(next) => {
              setTab(next);
              if (next === 'settings') setSettingsSeen(true);
            }}
            options={[
              { value: 'orders', label: 'الطلبات' },
              { value: 'settings', label: 'إعدادات المتجر' },
            ]}
          />
        ) : null}
        {/* Once opened, the settings stay mounted behind the tab: switching to the orders keeps what was typed */}
        {canSettings && (!both || settingsSeen || tab === 'settings') ? (
          <div hidden={both && tab !== 'settings'}>
            <SettingsCard />
          </div>
        ) : null}
        {canOrders && (!both || tab === 'orders') ? <OrdersCard canDecide={canDecide} /> : null}
      </SalesPage>
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
 * A fee as typed, strictly: digits (Arabic too), a point or «٫» for the decimals, a comma only as a
 * thousands mark (groups of three). «abc» or «1,5» is null, never a silent 0 or a tenfold fee.
 */
export function feeOf(text: string, decimals: number): number | null {
  const typed = text.trim();
  if (typed === '') return 0;
  const plain = [...typed]
    .map((ch) => {
      const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
      return arabic >= 0 ? String(arabic) : ch === '٫' ? '.' : ch === '٬' ? ',' : ch;
    })
    .join('');
  const [whole = '', ...rest] = plain.split('.');
  if (rest.length > 1 || (rest.length === 1 && (rest[0] === '' || rest[0]!.length > decimals))) return null;
  const groups = whole.split(',');
  if (groups.some((g) => g === '' || ![...g].every((ch) => ch >= '0' && ch <= '9'))) return null;
  if (groups.length > 1 && (groups[0]!.length > 3 || groups.slice(1).some((g) => g.length !== 3)))
    return null;
  return Math.round(Number(`${groups.join('')}${rest.length ? `.${rest[0]}` : ''}`) * 10 ** decimals);
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
  onInvalid,
  error,
}: {
  feeMinor: number;
  areas: DeliveryArea[];
  onChange: (feeMinor: number, areas: DeliveryArea[]) => void;
  /** Told when a fee is not a number, so the page does not save it as free delivery */
  onInvalid?: (invalid: boolean) => void;
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
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const push = (nextFlat: string, nextRows: { name: string; fee: string }[]) => {
    const wrong = new Set<string>();
    const flatMinor = nextRows.length === 0 ? feeOf(nextFlat, decimals) : (feeOf(nextFlat, decimals) ?? 0);
    if (flatMinor === null) wrong.add('flat');
    const kept: DeliveryArea[] = [];
    nextRows.forEach((r, i) => {
      const fee = feeOf(r.fee, decimals);
      if (fee === null) wrong.add(String(i));
      if (r.name.trim()) kept.push({ name: r.name.trim(), feeMinor: fee ?? 0 });
    });
    setBad(wrong);
    onInvalid?.(wrong.size > 0);
    onChange(flatMinor ?? 0, kept);
  };
  const fieldError = (key: string) =>
    bad.has(key) ? 'اكتب رقماً صحيحاً، مثل 1500 (الفاصلة للآلاف فقط)' : undefined;
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
          error={fieldError('flat')}
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
                  error={fieldError(String(i))}
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
  const [feeBad, setFeeBad] = useState(false);
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
    if (!form || whatsappError || feeBad) return;
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
        {form.catalogueCut ? (
          <Alert tone="warning">
            في محلك قطع أكثر مما تتسع له صفحة المتجر (5000 قطعة بمقاساتها وألوانها)، فالأخيرة حسب الاسم لا
            تظهر للزبائن. أخفِ ما لا تبيعه من المتجر أو قلّل المتغيرات.
          </Alert>
        ) : null}
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
                {...(form.version !== null && form.slug !== JSON.parse(kept).slug
                  ? { hint: 'تغيير الرابط يُبطل الروابط التي شاركتها وروابط تتبع الطلبات السابقة.' }
                  : {})}
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
                  description="يُحفظ الطلب هنا بحالة «بانتظار المحل» ولا يحجز شيئاً من المخزون حتى تقبله، ويفتح واتساب عند الزبون برسالة جاهزة إلى رقمك."
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
                  onInvalid={setFeeBad}
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
        <ShopLook
          form={form}
          saved={form.version !== null}
          onChange={set}
          onImages={(s) => {
            // The pictures are kept by the server at once: its version and addresses replace ours,
            // and what the owner typed and has not saved stays unsaved
            setForm((f) => (f ? { ...f, version: s.version, logoUrl: s.logoUrl, coverUrl: s.coverUrl } : f));
            setKept((k) =>
              JSON.stringify({
                ...JSON.parse(k),
                version: s.version,
                logoUrl: s.logoUrl,
                coverUrl: s.coverUrl,
              }),
            );
          }}
        />
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
                label="اعرض القطع التي نفد مخزونها"
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
              <Button
                loading={saving}
                disabled={Boolean(whatsappError) || feeBad}
                onClick={() => void save()}
              >
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

const ORDERS_PAGE = 50;

/**
 * The orders a page at a time. Only the newest answer for the filter and page on screen lands (a slow
 * one for another filter never does); `refresh` asks again without emptying the list, so the cards
 * and what they say (an error under a button) stay while the new answer comes.
 */
function useOrderPages(status: OnlineOrderStatus | 'all') {
  const [stack, setStack] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [answer, setAnswer] = useState<{
    key: string;
    items: OnlineOrder[];
    nextCursor: string | null;
    counts: { pending: number; accepted: number; all: number } | null;
  } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const cursor = stack.length > 0 ? stack[stack.length - 1]! : null;
  const key = `${status}|${cursor ?? ''}`;
  useEffect(() => {
    let current = true;
    listOrders(status, cursor).then(
      (page) => {
        if (!current) return;
        setError(null);
        setAnswer({ key, ...page });
      },
      (e: unknown) => current && setError({ key, text: errorMessage(e) }),
    );
    return () => {
      current = false;
    };
  }, [status, cursor, key, tick]);
  const fresh = answer?.key === key;
  const topRef = useRef<HTMLDivElement>(null);
  const page = stack.length + 1;
  const from = (page - 1) * ORDERS_PAGE + 1;
  const items = fresh ? answer.items : null;
  const pager: PagerState = {
    page,
    from,
    to: from + (items?.length ?? 0) - 1,
    hasNext: Boolean(fresh && answer.nextCursor),
    moving: 0,
    error: null,
    onPrev: () => setStack((s) => s.slice(0, -1)),
    onNext: () => {
      if (fresh && answer.nextCursor) setStack((s) => [...s, answer.nextCursor!]);
      topRef.current?.scrollIntoView?.({ block: 'start' });
    },
    onRetry: () => setTick((n) => n + 1),
    loading: !fresh && !error,
    wasPaged: stack.length > 0,
  };
  return {
    items,
    // The tabs' tallies come with every page; the last ones heard stay while a new page loads
    counts: answer?.counts ?? null,
    error: error?.key === key ? error.text : null,
    /** Asks again without emptying the list */
    refresh: useCallback(() => setTick((n) => n + 1), []),
    /** Back to the first page (a new filter) */
    first: useCallback(() => setStack([]), []),
    topRef,
    pager,
  };
}

function OrdersCard({ canDecide }: { canDecide: boolean }) {
  const me = useMe();
  const [status, setFilter] = useState<OnlineOrderStatus | 'all'>('pending');
  const { items, counts, error, refresh: load, first, topRef, pager } = useOrderPages(status);
  const [moveError, setError] = useState<string | null>(null);

  // The delivery card below asks again whenever an order changes
  const [changes, setChanges] = useState(0);
  // The orders being decided: their buttons are off until the answer, so a double click is one request
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  // Orders whose pieces the shelf does not hold: told once, accepted on the second press
  const [short, setShort] = useState<Readonly<Record<string, string[]>>>({});

  /** The lines of an order the stock cannot cover; empty when it can, or when stock is not readable here */
  async function shortLines(order: OnlineOrder): Promise<string[]> {
    try {
      const stock = await getStock();
      const held = new Map<string, number>();
      for (const row of stock.items) held.set(row.variantId, (held.get(row.variantId) ?? 0) + row.qty);
      return order.lines
        .filter((l) => held.has(l.variantId) && (held.get(l.variantId) ?? 0) < l.qty * 1000)
        .map((l) => `${l.name}${l.label ? ` (${l.label})` : ''}`);
    } catch {
      return [];
    }
  }

  async function move(order: OnlineOrder, next: 'accepted' | 'rejected' | 'done') {
    if (busy.has(order.id)) return;
    setBusy((b) => new Set(b).add(order.id));
    setError(null);
    try {
      if (next === 'accepted' && order.status === 'pending' && !short[order.id]) {
        const lacking = await shortLines(order);
        if (lacking.length > 0) {
          setShort((m) => ({ ...m, [order.id]: lacking }));
          return;
        }
      }
      // The second press after the warning accepts anyway: the server holds the pieces only when told so
      await setStatus(order, next, Boolean(short[order.id]));
    } catch (e) {
      // The server's own check (another desk took the last piece): the same warning, accepted on the next press
      if (e instanceof ApiError && e.fields?.stock && next === 'accepted') {
        setShort((m) => ({ ...m, [order.id]: [e.fields!.stock!] }));
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy((b) => {
        const rest = new Set(b);
        rest.delete(order.id);
        return rest;
      });
    }
    load();
    setChanges((n) => n + 1);
    // The sidebar badge counts what still waits
    window.dispatchEvent(new Event('serva:orders-changed'));
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
          onValueChange={(next) => {
            setFilter(next);
            first();
          }}
          options={[
            { value: 'pending', label: counts ? `بانتظار المحل (${counts.pending})` : 'بانتظار المحل' },
            { value: 'accepted', label: counts ? `مقبولة (${counts.accepted})` : 'مقبولة' },
            { value: 'all', label: counts ? `الكل (${counts.all})` : 'الكل' },
          ]}
        />
      </div>
      {error || moveError ? <Alert tone="error">{error ?? moveError}</Alert> : null}
      {items === null && !error ? (
        <ul
          aria-busy="true"
          aria-label="جارٍ تحميل الطلبات"
          className="grid items-start gap-4 xl:grid-cols-2"
        >
          {[0, 1].map((n) => (
            <li key={n}>
              <Card className="flex flex-col gap-4">
                <SkeletonText lines={1} />
                <SkeletonText lines={3} />
                <Skeleton className="h-11 w-40 rounded-control" />
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      {items && items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="لا طلبات هنا."
          description="كل طلب يرسله زبون من المتجر يظهر هنا لتقبله أو ترفضه."
        />
      ) : null}
      {items && items.length > 0 ? (
        <div ref={topRef} className="flex flex-col gap-4">
          <ul aria-label="طلبات المتجر" className="grid items-start gap-4 xl:grid-cols-2">
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
                      <StatusPill kind={STATUS_KIND[o.status]}>{STATUS_TEXT[o.status]}</StatusPill>
                      {o.source === 'shop' ? <Badge tone="neutral">رقم مؤكَّد</Badge> : null}
                      {o.couponCode ? (
                        <Badge tone="brand">
                          كود <bdi dir="ltr">{o.couponCode}</bdi>
                        </Badge>
                      ) : null}
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
                    <p className="text-xs text-ink-muted">
                      وصل في{' '}
                      <span className="whitespace-nowrap">
                        {zonedDateTime(o.createdAt, me.tenant.timezone, me.settings.numberFormat)}
                      </span>
                    </p>
                  </div>
                  <Amt minor={o.totalMinor} currency={o.currency} className="text-lg font-bold text-ink" />
                </div>
                <p className="text-sm text-ink">
                  {o.fulfilment === 'delivery' ? `توصيل إلى ${o.address ?? ''}` : 'استلام من المحل'}
                  {o.deliveryFeeMinor > 0 ? (
                    <span className="text-ink-muted">
                      {' '}
                      · أجرة التوصيل{o.deliveryArea ? ` (${o.deliveryArea})` : ''}{' '}
                      <Amt minor={o.deliveryFeeMinor} currency={o.currency} /> للمندوب
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
                {short[o.id] && o.status === 'pending' ? (
                  <Alert tone="warning">
                    لا يكفي المخزون لهذه القطع: {short[o.id]!.join('، ')}. اقبل الطلب رغم ذلك إن كانت البضاعة
                    في الطريق، أو ارفضه.
                  </Alert>
                ) : null}
                {canDecide &&
                o.fulfilment === 'delivery' &&
                (o.status === 'accepted' || o.status === 'done') ? (
                  <DeliveryActions
                    order={o}
                    store={me.tenant.name}
                    onChanged={() => {
                      load();
                      setChanges((n) => n + 1);
                    }}
                  />
                ) : null}
                {canDecide &&
                (o.status === 'pending' || o.status === 'cancel_requested' || o.status === 'accepted') ? (
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
                          {short[o.id] ? 'اقبل رغم النقص' : 'اقبل'}
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
                          قطعه محجوزة، ويبيعه الكاشير من «طلبات المتجر». «سُلّم دون بيع» يغلقه بلا فاتورة ولا
                          خصم من المخزون.
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
          <Pager noun="الطلبات" pager={pager} />
        </div>
      ) : null}
      {canDecide ? <CodCard refreshKey={changes} /> : null}
    </section>
  );
}
