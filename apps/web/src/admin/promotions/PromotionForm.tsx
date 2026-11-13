import { useEffect, useState, type ReactNode } from 'react';
import type { Category, Promotion, PromotionInput, PromotionKind, PromotionScope } from '@serva/core';
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
  Select,
  TextField,
  ToggleChip,
  cn,
  CONTROL_HEIGHT,
  useDensity,
} from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { listCategories, listProducts } from '../catalog/api';
import { categoryTree, categoryOptionLabel } from '../catalog/catalog';
import { createPromotion, updatePromotion } from './api';

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

function endDate(iso: string): string {
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
  const [couponCode, setCouponCode] = useState(promotion?.couponCode ?? '');
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const density = useDensity();

  useEffect(() => {
    listCategories()
      .then((r) => setCategories(r.items.filter((c) => !c.archivedAt)))
      .catch(() => setCategories([]));
    listProducts({ limit: 200 })
      .then((r) => setNames(new Map(r.items.map((p) => [p.id, p.nameAr]))))
      .catch(() => undefined);
  }, []);

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

  async function save() {
    const bp = Math.round(Number(digits(percent)) * 100);
    if (kind === 'percent' && (!Number.isFinite(bp) || bp <= 0 || bp > 10_000)) {
      setFields({ percentBp: 'اكتب نسبة بين 1 و100' });
      return;
    }
    const input: PromotionInput = {
      name,
      kind,
      percentBp: kind === 'percent' ? bp : null,
      buyQty: kind === 'buy_get' ? Number(digits(buy)) || null : null,
      getQty: kind === 'buy_get' ? Number(digits(get)) || null : null,
      scope,
      categoryIds,
      productIds,
      startsAt: dateBound(from, false),
      endsAt: dateBound(to, true),
      daysOfWeek: days,
      fromTime: fromTime || null,
      toTime: toTime || null,
      couponCode: couponCode.trim() || null,
      archived: promotion?.archived ?? false,
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold text-ink-muted">نوع العرض</legend>
          <div className="grid gap-3">
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
        ) : (
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

      {/* The sheet's foot: pinned while the fields scroll, flush with the sheet's edges. */}
      <div className="sticky -bottom-5 z-10 -mx-6 mt-auto -mb-5 flex flex-wrap justify-end gap-3 border-t border-line bg-surface px-6 py-4">
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
