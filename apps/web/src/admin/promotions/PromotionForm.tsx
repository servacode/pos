import { useEffect, useState } from 'react';
import type { Category, Promotion, PromotionInput, PromotionKind, PromotionScope } from '@serva/core';
import { Alert, Button, SearchField, SegmentedControl, Select, TextField, ToggleChip } from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <TextField
        label="اسم العرض كما يُطبع على الإيصال"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fields.name}
      />
      <SegmentedControl
        label="نوع العرض"
        value={kind}
        onValueChange={setKind}
        options={[
          { value: 'percent', label: 'خصم بنسبة' },
          { value: 'buy_get', label: 'اشترِ واحصل مجاناً' },
        ]}
      />
      {kind === 'percent' ? (
        <TextField
          label="نسبة الخصم %"
          inputMode="decimal"
          dir="ltr"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          error={fields.percentBp}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="يشتري الزبون (قطعة)"
            inputMode="numeric"
            dir="ltr"
            value={buy}
            onChange={(e) => setBuy(e.target.value)}
            error={fields.buyQty}
          />
          <TextField
            label="ويأخذ مجاناً (قطعة)"
            inputMode="numeric"
            dir="ltr"
            value={get}
            onChange={(e) => setGet(e.target.value)}
            error={fields.getQty}
          />
        </div>
      )}
      <Select label="على ماذا" value={scope} onChange={(e) => setScope(e.target.value as PromotionScope)}>
        <option value="all">كل المنتجات</option>
        <option value="categories">تصنيفات محددة</option>
        <option value="products">منتجات محددة</option>
      </Select>
      {scope === 'categories' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-ink">التصنيفات (وما تحتها)</legend>
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
          {fields.categoryIds ? <p className="text-sm text-danger-ink">{fields.categoryIds}</p> : null}
        </fieldset>
      ) : null}
      {scope === 'products' ? (
        <div className="flex flex-col gap-2">
          <SearchField label="ابحث عن منتج لإضافته" value={search} onValueChange={setSearch} />
          {found.length > 0 ? (
            <ul aria-label="نتائج البحث" className="flex flex-wrap gap-2">
              {found.map((p) => (
                <li key={p.id}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setProductIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]))}
                  >
                    + {p.nameAr}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
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
          {fields.productIds ? <p className="text-sm text-danger-ink">{fields.productIds}</p> : null}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="من تاريخ (اختياري)"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="حتى تاريخ (اختياري)"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          error={fields.endsAt}
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">الأيام (بلا اختيار: كل الأيام)</legend>
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
      <div className="grid gap-4 md:grid-cols-2">
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
