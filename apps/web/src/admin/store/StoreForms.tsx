import { useState } from 'react';
import {
  SECTORS,
  storeCurrencyInput,
  storeProfileInput,
  type SectorKey,
  type StoreCurrencyInput,
  type StoreProfileInput,
  type StoreResponse,
} from '@serva/core';
import { Alert, Button, Card, Switch, TextField, ToggleChip } from '@serva/ui';
import { useForm } from '../../lib/useForm';
import { saveCurrency, saveProfile } from './api';

/** The activities as chips: one or more (04 › شو بتشتغل؟) */
export function SectorPicker({
  value,
  onChange,
  error,
}: {
  value: SectorKey[];
  onChange: (next: SectorKey[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-semibold text-ink">شو بتشتغل؟ اختر نشاطاً واحداً أو أكثر</legend>
      <div className="flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <ToggleChip
            key={s.key}
            name="sectors"
            label={s.labelAr}
            checked={value.includes(s.key)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, s.key] : value.filter((k) => k !== s.key))
            }
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

interface ProfileValues {
  name: string;
  sectors: SectorKey[];
  legalName: string;
  taxNumber: string;
  address: string;
  phone: string;
  receiptFooter: string;
}

const profileValues = (store: StoreResponse): ProfileValues => ({
  name: store.name,
  sectors: store.sectors,
  legalName: store.legalName ?? '',
  taxNumber: store.taxNumber ?? '',
  address: store.address ?? '',
  phone: store.phone ? `0${store.phone.replace(/^\+963/, '')}` : '',
  receiptFooter: store.receiptFooter ?? '',
});

/** The top of the receipt as it will print, while the owner types (04 › معاينة حيّة للإيصال) */
export function ReceiptPreview({ values }: { values: ProfileValues }) {
  return (
    <div
      aria-label="معاينة رأس الإيصال"
      className="mx-auto w-full max-w-[18rem] rounded-sm border border-dashed border-line bg-surface p-4 text-center font-mono text-sm text-ink shadow-e1"
    >
      <p className="text-base font-bold">{values.name || 'اسم المحل'}</p>
      {values.legalName ? <p className="text-xs">{values.legalName}</p> : null}
      {values.address ? <p className="text-xs">{values.address}</p> : null}
      {values.phone ? (
        <p className="text-xs" dir="ltr">
          {values.phone}
        </p>
      ) : null}
      {values.taxNumber ? <p className="text-xs">الرقم الضريبي: {values.taxNumber}</p> : null}
      <p className="my-2 border-t border-dashed border-line" />
      <p className="text-xs text-ink-muted">… أسطر الفاتورة …</p>
      <p className="my-2 border-t border-dashed border-line" />
      <p className="text-xs">{values.receiptFooter || 'شكراً لزيارتكم'}</p>
    </div>
  );
}

export function ProfileForm({
  store,
  onSaved,
  submitLabel = 'احفظ',
  showSectors = true,
}: {
  store: StoreResponse;
  onSaved: (store: StoreResponse) => void;
  submitLabel?: string;
  showSectors?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const form = useForm<ProfileValues, StoreProfileInput>({
    initialValues: () => profileValues(store),
    fieldOrder: ['name', 'sectors', 'legalName', 'taxNumber', 'address', 'phone', 'receiptFooter'],
    validate: (v) => storeProfileInput.safeParse(v),
    onSubmit: async (input) => {
      setSaved(false);
      onSaved(await saveProfile(input));
      setSaved(true);
    },
  });
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = form;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <Card>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          {saved ? <Alert tone="success">حُفظت معلومات المحل.</Alert> : null}
          <TextField
            name="name"
            label="اسم المحل"
            hint="كما يظهر على الفاتورة"
            value={values.name}
            onChange={(e) => setValue('name', e.target.value)}
            error={errors.name}
          />
          {showSectors ? (
            <SectorPicker
              value={values.sectors}
              onChange={(next) => setValue('sectors', next)}
              error={errors.sectors}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="address"
              label="العنوان"
              value={values.address}
              onChange={(e) => setValue('address', e.target.value)}
              error={errors.address}
            />
            <TextField
              name="phone"
              label="هاتف المحل"
              inputMode="tel"
              dir="ltr"
              value={values.phone}
              onChange={(e) => setValue('phone', e.target.value)}
              error={errors.phone}
            />
            <TextField
              name="legalName"
              label="الاسم التجاري (اختياري)"
              value={values.legalName}
              onChange={(e) => setValue('legalName', e.target.value)}
              error={errors.legalName}
            />
            <TextField
              name="taxNumber"
              label="الرقم الضريبي (إن وُجد)"
              value={values.taxNumber}
              onChange={(e) => setValue('taxNumber', e.target.value)}
              error={errors.taxNumber}
            />
          </div>
          <TextField
            name="receiptFooter"
            label="سطر أسفل الفاتورة"
            hint="مثل: شكراً لزيارتكم، أو سياسة الإرجاع"
            value={values.receiptFooter}
            onChange={(e) => setValue('receiptFooter', e.target.value)}
            error={errors.receiptFooter}
          />
          <div className="flex justify-end border-t border-line pt-4">
            <Button type="submit" size="lg" loading={submitting} className="max-sm:w-full">
              {submitLabel}
            </Button>
          </div>
        </form>
      </Card>
      <div className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
        <p className="text-sm font-semibold text-ink-muted">كيف تظهر على الفاتورة</p>
        <ReceiptPreview values={values} />
      </div>
    </div>
  );
}

interface CurrencyValues {
  usdEnabled: boolean;
  usdRate: string;
  taxInclusive: boolean;
}

export function CurrencyForm({
  store,
  onSaved,
  submitLabel = 'احفظ',
}: {
  store: StoreResponse;
  onSaved: (store: StoreResponse) => void;
  submitLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const form = useForm<CurrencyValues, StoreCurrencyInput>({
    initialValues: () => ({
      usdEnabled: store.enabledCurrencies.includes('USD'),
      usdRate: store.usdRate ?? '',
      taxInclusive: store.taxInclusive,
    }),
    fieldOrder: ['usdEnabled', 'usdRate', 'taxInclusive'],
    validate: (v) =>
      storeCurrencyInput.safeParse({
        usdEnabled: v.usdEnabled,
        // Empty is «no rate yet» («اكتب سعر الدولار اليوم»), not a malformed one
        usdRate: v.usdEnabled && v.usdRate.trim() ? v.usdRate : null,
        taxInclusive: v.taxInclusive,
      }),
    onSubmit: async (input) => {
      setSaved(false);
      onSaved(await saveCurrency(input));
      setSaved(true);
    },
  });
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = form;

  return (
    <Card>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {saved ? <Alert tone="success">حُفظت العملة وسعر الصرف.</Alert> : null}
        <p className="rounded-control bg-surface-muted px-4 py-3 text-ink">
          العملة الأساسية <strong>الليرة السورية</strong>: بها تُحسب الحسابات والتقارير.
        </p>
        <Switch
          label="أبيع بعض الأصناف بالدولار، أو أقبل الدفع بالدولار"
          description="يظهر الدولار عند الدفع، ويتحوّل إلى الليرة بسعر اليوم"
          checked={values.usdEnabled}
          onCheckedChange={(checked) => setValue('usdEnabled', checked)}
        />
        {values.usdEnabled ? (
          <TextField
            name="usdRate"
            label="سعر الدولار اليوم بالليرة"
            hint="تعدّله كلما تغيّر. الفواتير السابقة تبقى بالسعر الذي بيعت به"
            inputMode="decimal"
            dir="ltr"
            inputClassName="num"
            value={values.usdRate}
            onChange={(e) => setValue('usdRate', e.target.value)}
            error={errors.usdRate}
          />
        ) : null}
        <div className="border-t border-line pt-5">
          <Switch
            label="أسعار الرفوف تشمل الضريبة"
            description="الشائع في سوريا. إن أطفأته تُضاف الضريبة فوق السعر عند البيع"
            checked={values.taxInclusive}
            onCheckedChange={(checked) => setValue('taxInclusive', checked)}
          />
        </div>
        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" size="lg" loading={submitting} className="max-sm:w-full">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
