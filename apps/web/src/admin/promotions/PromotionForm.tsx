import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CUSTOMER_KINDS,
  CUSTOMER_KIND_LABELS,
  type Category,
  type CustomerKind,
  type Promotion,
  type PromotionInput,
  type PromotionPreview,
  type PromotionKind,
  type PromotionScope,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  CheckIcon,
  ChoiceCard,
  FieldError,
  GiftIcon,
  PercentIcon,
  SearchField,
  Money,
  Select,
  TextField,
  ToggleChip,
  cn,
  CONTROL_HEIGHT,
  useDensity,
} from '@serva/ui';
import { CURRENCIES } from '@serva/core/currencies';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { getProduct, listCategories, listProducts } from '../catalog/api';
import { categoryTree, categoryOptionLabel } from '../catalog/catalog';
import { createPromotion, previewPromotion, updatePromotion } from './api';

/** The store's clock: Syria keeps UTC+3 all year. */
const OFFSET = '+03:00';
export const WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** «2026-11-03» of an instant, on the store's clock */
export function localDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date(iso));
}

/** The first moment of a local date; for the end, the first moment after it (the end day is included). */
export function dateBound(date: string, end: boolean): string | null {
  if (!date) return null;
  const start = new Date(`${date}T00:00:00${OFFSET}`);
  if (end) start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

/** The last day an offer runs, as a local date: the stored end is the first moment after it */
export function endDate(iso: string): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return localDate(d.toISOString());
}

const digits = (v: string) => v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();

/** Adds or edits a promotion: what it gives, on what, and when. */
export function PromotionForm({
  promotion,
  onSaved,
  onCancel,
}: {
  promotion?: Promotion;
  onSaved: (saved: Promotion) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(promotion?.name ?? '');
  const [kind, setKind] = useState<PromotionKind>(promotion?.kind ?? 'percent');
  const [percent, setPercent] = useState(promotion?.percentBp ? String(promotion.percentBp / 100) : '');
  const [buy, setBuy] = useState(String(promotion?.buyQty ?? 2));
  const [get, setGet] = useState(String(promotion?.getQty ?? 1));
  const [scope, setScope] = useState<PromotionScope>(promotion?.scope ?? 'all');
  const [categoryIds, setCategoryIds] = useState<string[]>(promotion?.categoryIds ?? []);
  const [productIds, setProductIds] = useState<string[]>(promotion?.productIds ?? []);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [found, setFound] = useState<{ id: string; nameAr: string }[]>([]);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(promotion?.startsAt ? localDate(promotion.startsAt) : '');
  const [to, setTo] = useState(promotion?.endsAt ? endDate(promotion.endsAt) : '');
  const [days, setDays] = useState<number[]>(promotion?.daysOfWeek ?? []);
  const [fromTime, setFromTime] = useState(promotion?.fromTime ?? '');
  const [toTime, setToTime] = useState(promotion?.toTime ?? '');
  // Trade promotions: the steps of «حسب الكمية», the gift of «صنف مجاني», and who it is for
  const [tiers, setTiers] = useState<{ minQty: string; percent: string }[]>(
    promotion?.tiers?.length
      ? promotion.tiers.map((t) => ({ minQty: String(t.minQty), percent: String(t.percentBp / 100) }))
      : [{ minQty: '10', percent: '' }],
  );
  const [freeVariantId, setFreeVariantId] = useState(promotion?.freeVariantId ?? '');
  const [freeName, setFreeName] = useState('');
  const [freeOptions, setFreeOptions] = useState<{ id: string; label: string }[]>([]);
  const [freeSearch, setFreeSearch] = useState('');
  const [freeFound, setFreeFound] = useState<
    { id: string; nameAr: string; singleVariantId: string | null }[]
  >([]);
  const [freeQty, setFreeQty] = useState(String(promotion?.freeQty ?? 1));
  const [customerKinds, setCustomerKinds] = useState<CustomerKind[]>(promotion?.customerKinds ?? []);
  const [priceTiers, setPriceTiers] = useState<('retail' | 'wholesale')[]>(promotion?.priceTiers ?? []);
  const [repOnly, setRepOnly] = useState(promotion?.repOnly ?? false);
  const [couponCode, setCouponCode] = useState(promotion?.couponCode ?? '');
  // A new offer may be kept stopped until the owner is ready: it then touches no till and no shop page
  const [startStopped, setStartStopped] = useState(false);
  const me = useMe();
  // Business customer kinds mean nothing to a shop that sells to people only (clothes, coffee, cosmetics...)
  const retailOnly = me.tenant.sectors.every((k) =>
    ['clothing', 'cafe', 'cosmetics', 'electronics', 'bakery'].includes(k),
  );
  // «كما يراها الزبون»: a sample piece with the offer taken off, as the shop and the receipt will show it
  const sampleBase = me.settings.baseCurrency;
  const samplePercent = Number(digits(percent));
  const sample =
    kind === 'percent' && samplePercent > 0 && samplePercent <= 100
      ? (() => {
          const was = 100_000 * 10 ** CURRENCIES[sampleBase].decimals;
          return { was, now: Math.round(was * (1 - samplePercent / 100)) };
        })()
      : null;
  const showKinds = !retailOnly || customerKinds.length > 0;
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const density = useDensity();
  const formRef = useRef<HTMLFormElement>(null);
  // The first field that is wrong is brought into view and focused, so its sentence is never below the fold
  useEffect(() => {
    if (Object.keys(fields).length === 0) return;
    const bad = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    bad?.scrollIntoView?.({ block: 'center' });
    bad?.focus?.({ preventScroll: true });
  }, [fields]);
  // How many products the offer reaches, asked of the server while the owner picks the scope
  const [reach, setReach] = useState<PromotionPreview | null>(null);
  useEffect(() => {
    if (
      (scope === 'categories' && categoryIds.length === 0) ||
      (scope === 'products' && productIds.length === 0)
    ) {
      setReach(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      previewPromotion({ scope, categoryIds, productIds }).then(
        (r) => current && setReach(r),
        () => current && setReach(null),
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [scope, categoryIds, productIds]);

  useEffect(() => {
    listCategories()
      .then((r) => setCategories(r.items.filter((c) => !c.archivedAt)))
      .catch(() => setCategories([]));
    listProducts({ limit: 200 })
      .then((r) => setNames(new Map(r.items.map((p) => [p.id, p.nameAr]))))
      .catch(() => undefined);
  }, []);

  // The offer's products the first 200 did not name: asked one by one, so no chip reads just «منتج»
  const askedNames = useRef(new Set<string>());
  useEffect(() => {
    for (const id of productIds) {
      if (names.has(id) || askedNames.current.has(id) || askedNames.current.size >= 40) continue;
      askedNames.current.add(id);
      getProduct(id)
        .then((p) => setNames((m) => new Map(m).set(id, p.nameAr)))
        .catch(() => undefined);
    }
  }, [productIds, names]);

  useEffect(() => {
    if (scope !== 'products' || search.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      listProducts({ q: search.trim(), limit: 8 })
        .then((r) => {
          setFound(r.items.map((p) => ({ id: p.id, nameAr: p.nameAr })));
          setNames((m) => new Map([...m, ...r.items.map((p) => [p.id, p.nameAr] as const)]));
        })
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, scope]);

  useEffect(() => {
    if (kind !== 'free_item' || freeSearch.trim().length < 2) {
      setFreeFound([]);
      return;
    }
    const timer = setTimeout(() => {
      listProducts({ q: freeSearch.trim(), limit: 8 })
        .then((r) =>
          setFreeFound(
            r.items.map((p) => ({ id: p.id, nameAr: p.nameAr, singleVariantId: p.singleVariantId })),
          ),
        )
        .catch(() => setFreeFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [freeSearch, kind]);

  /** The gift is one variant: a product with one is taken at once, else its variants are offered */
  async function pickGift(p: { id: string; nameAr: string; singleVariantId: string | null }) {
    setFreeSearch('');
    setFreeFound([]);
    setFreeName(p.nameAr);
    if (p.singleVariantId) {
      setFreeVariantId(p.singleVariantId);
      setFreeOptions([]);
      return;
    }
    setFreeVariantId('');
    try {
      const detail = await getProduct(p.id);
      setFreeOptions(
        detail.variants.filter((v) => !v.archivedAt).map((v) => ({ id: v.id, label: v.label ?? p.nameAr })),
      );
    } catch {
      setFreeOptions([]);
    }
  }

  async function save() {
    if (name.trim().length < 2) {
      setFields({ name: 'اسم العرض مطلوب' });
      return;
    }
    const bp = Math.round(Number(digits(percent)) * 100);
    if (kind === 'percent' && (!Number.isFinite(bp) || bp <= 0 || bp > 10_000)) {
      setFields({ percentBp: 'اكتب نسبة بين 1 و100' });
      return;
    }
    const steps = tiers
      .filter((t) => digits(t.minQty) !== '' || digits(t.percent) !== '')
      .map((t) => ({
        minQty: Number(digits(t.minQty)),
        percentBp: Math.round(Number(digits(t.percent)) * 100),
      }));
    if (
      kind === 'tiered' &&
      steps.some((t) => !Number.isFinite(t.percentBp) || t.percentBp <= 0 || t.percentBp > 10_000)
    ) {
      setFields({ tiers: 'اكتب نسبة بين 1 و100 في كل شريحة' });
      return;
    }
    if (kind === 'free_item' && !freeVariantId) {
      setFields({ freeVariantId: 'اختر الصنف المجاني' });
      return;
    }
    if (
      (kind === 'percent' || kind === 'buy_get') &&
      couponCode.trim() &&
      (repOnly || customerKinds.length > 0 || priceTiers.length > 0)
    ) {
      setFields({
        couponCode: 'الكود لا يعمل مع عرض مخصص لفئة من الزبائن أو للمندوب. أزل أحدهما',
      });
      return;
    }
    const input: PromotionInput = {
      name,
      kind,
      percentBp: kind === 'percent' ? bp : null,
      buyQty: kind === 'buy_get' || kind === 'free_item' ? Number(digits(buy)) || null : null,
      getQty: kind === 'buy_get' ? Number(digits(get)) || null : null,
      tiers: kind === 'tiered' ? steps : [],
      freeVariantId: kind === 'free_item' ? freeVariantId || null : null,
      freeQty: kind === 'free_item' ? Number(digits(freeQty)) || null : null,
      customerKinds,
      priceTiers,
      repOnly,
      scope,
      categoryIds,
      productIds,
      startsAt: dateBound(from, false),
      endsAt: dateBound(to, true),
      daysOfWeek: days,
      fromTime: fromTime || null,
      toTime: toTime || null,
      couponCode: kind === 'percent' || kind === 'buy_get' ? couponCode.trim() || null : null,
      archived: promotion ? promotion.archived : startStopped,
    };
    setSaving(true);
    setError(null);
    setFields({});
    try {
      onSaved(
        promotion
          ? await updatePromotion(promotion.id, { ...input, version: promotion.version })
          : await createPromotion(input),
      );
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
      setSaving(false);
    }
  }

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <form
      ref={formRef}
      aria-label={promotion ? 'عدّل العرض' : 'عرض جديد'}
      // Fills the sheet's body; the actions stay at its foot while the fields scroll under them.
      className="flex flex-1 flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      <FormSection title="ماذا يعطي">
        <TextField
          label="اسم العرض كما يُطبع على الإيصال"
          hint="يظهر هذا الاسم أيضاً لزبائن المتجر الإلكتروني على القطع المخفّضة."
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold text-ink-muted">نوع العرض</legend>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <ChoiceCard
              name="promotion-kind"
              title="خصم بنسبة"
              leading={<PercentIcon />}
              checked={kind === 'percent'}
              onChange={() => setKind('percent')}
            />
            <ChoiceCard
              name="promotion-kind"
              title="اشترِ واحصل مجاناً"
              leading={<GiftIcon />}
              checked={kind === 'buy_get'}
              onChange={() => setKind('buy_get')}
            />
            <ChoiceCard
              name="promotion-kind"
              title="خصم حسب الكمية"
              description="كلما زادت الكمية زاد الخصم"
              leading={<PercentIcon />}
              checked={kind === 'tiered'}
              onChange={() => setKind('tiered')}
            />
            <ChoiceCard
              name="promotion-kind"
              title="هدية من صنف آخر"
              description="اشترِ صنفاً وخذ آخر مجاناً"
              leading={<GiftIcon />}
              checked={kind === 'free_item'}
              onChange={() => setKind('free_item')}
            />
          </div>
        </fieldset>
        {kind === 'percent' ? (
          <TextField
            label="نسبة الخصم %"
            inputMode="decimal"
            dir="ltr"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            error={fields.percentBp}
            inputClassName="num"
            endAdornment={
              <span aria-hidden="true" className="me-3 text-sm font-semibold">
                %
              </span>
            }
            className="sm:max-w-48"
          />
        ) : kind === 'buy_get' ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="يشتري الزبون (قطعة)"
              inputMode="numeric"
              dir="ltr"
              value={buy}
              onChange={(e) => setBuy(e.target.value)}
              error={fields.buyQty}
              inputClassName="num"
            />
            <TextField
              label="ويأخذ مجاناً (قطعة)"
              inputMode="numeric"
              dir="ltr"
              value={get}
              onChange={(e) => setGet(e.target.value)}
              error={fields.getQty}
              inputClassName="num"
            />
          </div>
        ) : kind === 'tiered' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-sm font-semibold text-ink-muted">شرائح الخصم</legend>
            {tiers.map((t, i) => (
              <div
                key={i}
                className="grid items-end gap-3"
                style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}
              >
                <TextField
                  label={`من كم قطعة (شريحة ${i + 1})`}
                  inputMode="numeric"
                  dir="ltr"
                  value={t.minQty}
                  onChange={(e) =>
                    setTiers((list) => list.map((x, k) => (k === i ? { ...x, minQty: e.target.value } : x)))
                  }
                  inputClassName="num"
                />
                <TextField
                  label="الخصم %"
                  inputMode="decimal"
                  dir="ltr"
                  value={t.percent}
                  onChange={(e) =>
                    setTiers((list) => list.map((x, k) => (k === i ? { ...x, percent: e.target.value } : x)))
                  }
                  inputClassName="num"
                />
                <Button
                  variant="secondary"
                  aria-label={`احذف الشريحة ${i + 1}`}
                  disabled={tiers.length === 1}
                  onClick={() => setTiers((list) => list.filter((_, k) => k !== i))}
                >
                  حذف
                </Button>
              </div>
            ))}
            {fields.tiers ? <FieldError>{fields.tiers}</FieldError> : null}
            <div>
              <Button
                variant="secondary"
                icon={<AddIcon size={16} />}
                onClick={() => setTiers((list) => [...list, { minQty: '', percent: '' }])}
              >
                أضف شريحة
              </Button>
            </div>
          </fieldset>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="يشتري الزبون (قطعة)"
                inputMode="numeric"
                dir="ltr"
                value={buy}
                onChange={(e) => setBuy(e.target.value)}
                error={fields.buyQty}
                inputClassName="num"
              />
              <TextField
                label="ويأخذ مجاناً (قطعة)"
                inputMode="numeric"
                dir="ltr"
                value={freeQty}
                onChange={(e) => setFreeQty(e.target.value)}
                error={fields.freeQty}
                inputClassName="num"
              />
            </div>
            <SearchField
              label="الصنف المجاني: ابحث بالاسم"
              value={freeSearch}
              onValueChange={setFreeSearch}
            />
            {freeFound.length > 0 ? (
              <ul
                aria-label="نتائج الصنف المجاني"
                className="flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-e2"
              >
                {freeFound.map((p) => (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => void pickGift(p)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 text-start text-[0.9375rem] text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted',
                        CONTROL_HEIGHT[density],
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{p.nameAr}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {freeOptions.length > 0 ? (
              <Select
                label={`اختر نوع ${freeName}`}
                value={freeVariantId}
                onChange={(e) => setFreeVariantId(e.target.value)}
              >
                <option value="">اختر</option>
                {freeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : null}
            {freeVariantId ? (
              <p className="text-sm font-semibold text-success-ink">
                الصنف المجاني: {freeName || 'الصنف المختار'}
              </p>
            ) : (
              <p className="text-sm text-ink-subtle">لم تختر الصنف المجاني بعد.</p>
            )}
            {fields.freeVariantId ? <FieldError>{fields.freeVariantId}</FieldError> : null}
          </div>
        )}
      </FormSection>

      <FormSection title="على ماذا ينطبق">
        <Select label="على ماذا" value={scope} onChange={(e) => setScope(e.target.value as PromotionScope)}>
          <option value="all">كل المنتجات</option>
          <option value="categories">تصنيفات محددة</option>
          <option value="products">منتجات محددة</option>
        </Select>
        {scope === 'categories' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold text-ink-muted">التصنيفات (وما تحتها)</legend>
            <div className="flex flex-wrap gap-2">
              {categoryTree(categories).map((node) => (
                <ToggleChip
                  key={node.category.id}
                  label={categoryOptionLabel(node)}
                  checked={categoryIds.includes(node.category.id)}
                  onChange={() => setCategoryIds((ids) => toggle(ids, node.category.id))}
                />
              ))}
            </div>
            {fields.categoryIds ? <FieldError>{fields.categoryIds}</FieldError> : null}
          </fieldset>
        ) : null}
        {scope === 'products' ? (
          <div className="flex flex-col gap-3">
            <SearchField label="ابحث عن منتج لإضافته" value={search} onValueChange={setSearch} />
            {found.length > 0 ? (
              <ul
                aria-label="نتائج البحث"
                className="flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-e2"
              >
                {found.map((p) => {
                  const added = productIds.includes(p.id);
                  return (
                    <li key={p.id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        onClick={() => setProductIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]))}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 text-start text-[0.9375rem] text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted',
                          CONTROL_HEIGHT[density],
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="sr-only">أضف </span>
                          {p.nameAr}
                          {added ? <span className="sr-only">، مضاف</span> : null}
                        </span>
                        {added ? (
                          <CheckIcon size={16} className="text-brand-ink" />
                        ) : (
                          <AddIcon size={16} className="text-ink-subtle" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {productIds.length > 0 ? (
              <ul aria-label="منتجات العرض" className="flex flex-wrap gap-2">
                {productIds.map((id) => (
                  <li key={id}>
                    <ToggleChip
                      label={names.get(id) ?? 'منتج'}
                      checked
                      onChange={() => setProductIds((ids) => ids.filter((x) => x !== id))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle">لم تختر منتجات بعد: ابحث بالاسم وأضفها.</p>
            )}
            {fields.productIds ? <FieldError>{fields.productIds}</FieldError> : null}
          </div>
        ) : null}
      </FormSection>

      <FormSection
        title="لمن العرض"
        description="اترك الكل فارغاً ليشمل كل الزبائن. العرض الخاص يظهر على السلة حين يكون الزبون من اختيارك."
      >
        {showKinds ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold text-ink-muted">نوع الزبون</legend>
            <div className="flex flex-wrap gap-2">
              {CUSTOMER_KINDS.map((k) => (
                <ToggleChip
                  key={k}
                  label={CUSTOMER_KIND_LABELS[k]}
                  checked={customerKinds.includes(k)}
                  onChange={() => setCustomerKinds((list) => toggle(list, k))}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-semibold text-ink-muted">قائمة السعر</legend>
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              label="زبائن المفرق"
              checked={priceTiers.includes('retail')}
              onChange={() => setPriceTiers((list) => toggle(list, 'retail'))}
            />
            <ToggleChip
              label="زبائن الجملة"
              checked={priceTiers.includes('wholesale')}
              onChange={() => setPriceTiers((list) => toggle(list, 'wholesale'))}
            />
          </div>
        </fieldset>
        <ToggleChip label="على هاتف المندوب فقط" checked={repOnly} onChange={() => setRepOnly((v) => !v)} />
      </FormSection>

      {kind === 'percent' || kind === 'buy_get' ? (
        <FormSection
          title="كود الخصم"
          description="اختياري: بدل أن يعمل العرض وحده، يكتب الزبون الكود في سلة المتجر الإلكتروني فيُطبَّق على طلبه."
        >
          <TextField
            label="الكود (اختياري)"
            dir="ltr"
            placeholder="SUMMER10"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.slice(0, 20))}
            error={fields.couponCode}
          />
        </FormSection>
      ) : null}

      <FormSection title="متى يعمل" description="اترك ما لا تحتاجه فارغاً: يعمل كل يوم وطوال الوقت.">
        <div className="grid grid-cols-2 gap-3">
          <DateField label="من تاريخ (اختياري)" value={from} onChange={setFrom} />
          <DateField label="حتى تاريخ (اختياري)" value={to} onChange={setTo} error={fields.endsAt} />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-muted">
            الأيام (بلا اختيار: كل الأيام)
          </legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((day, i) => (
              <ToggleChip
                key={day}
                label={day}
                checked={days.includes(i)}
                onChange={() => setDays((d) => toggle(d, i))}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="من الساعة (اختياري)"
            type="time"
            dir="ltr"
            value={fromTime}
            onChange={(e) => setFromTime(e.target.value)}
          />
          <TextField
            label="حتى الساعة"
            type="time"
            dir="ltr"
            value={toTime}
            onChange={(e) => setToTime(e.target.value)}
            error={fields.toTime}
          />
        </div>
      </FormSection>

      {/* What saving does, in the flow of the form: the pinned foot below keeps to one short row. */}
      <section
        aria-label="ملخص العرض"
        className="flex flex-col gap-1.5 rounded-card border border-line bg-surface-muted px-4 py-3 text-sm text-ink-muted"
      >
        <p>
          {startStopped || promotion?.archived
            ? 'يُحفظ متوقفاً: لا يعمل على الكاشير ولا يظهر في المتجر حتى تشغّله.'
            : `يعمل فور الحفظ ${scope === 'all' ? 'على كل المنتجات' : scope === 'categories' ? 'على التصنيفات المختارة' : 'على المنتجات المختارة'}، وتراه الزبائن في المتجر الإلكتروني${
                couponCode.trim() && (kind === 'percent' || kind === 'buy_get') ? ' بعد كتابة الكود' : ''
              }.`}
        </p>
        {sample ? (
          <p data-testid="promotion-sample">
            كما يراها الزبون: قطعة بـ{' '}
            <Money minor={sample.was} currency={sampleBase} className="line-through" /> تصبح{' '}
            <Money minor={sample.now} currency={sampleBase} className="font-semibold text-ink" />، وعليها «خصم{' '}
            {samplePercent}%».
          </p>
        ) : null}
        {reach ? (
          <p data-testid="promotion-reach">
            <strong className="font-semibold text-ink">
              يطال {reach.products === 0 ? 'لا منتجات' : `${productsPhrase(reach.products)} في الكاشير`}
            </strong>
            {reach.products > 0 ? `، منها ${reach.shopProducts} في المتجر الإلكتروني` : ''}
            {reach.sample.length > 0 ? ` (مثل: ${reach.sample.join('، ')})` : ''}.
          </p>
        ) : null}
      </section>

      {/* The sheet's foot: pinned while the fields scroll, flush with the sheet's edges; one row. */}
      <div className="sticky -bottom-5 z-10 -mx-6 mt-auto -mb-5 flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        {promotion ? null : (
          <ToggleChip
            label="احفظه متوقفاً"
            checked={startStopped}
            onChange={() => setStartStopped((v) => !v)}
          />
        )}
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" loading={saving}>
          احفظ
        </Button>
      </div>
    </form>
  );
}

/** «38 منتجاً»: the counted noun the way Arabic writes it */
function productsPhrase(n: number): string {
  if (n === 1) return 'منتج واحد';
  if (n === 2) return 'منتجان';
  return n <= 10 ? `${n} منتجات` : `${n} منتجاً`;
}

/** A titled group of the form's fields, with a hairline above every group but the first. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-line not-first-of-type:border-t not-first-of-type:pt-6">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
