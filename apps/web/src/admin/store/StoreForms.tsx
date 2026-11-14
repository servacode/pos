import { useState, type ReactNode } from 'react';
import {
  SECTORS,
  storeCurrencyInput,
  storeProfileInput,
  type SectorKey,
  type StoreCurrencyInput,
  type StoreProfileInput,
  type StoreResponse,
} from '@serva/core';
import {
  BakeryIcon,
  BuildingMaterialsIcon,
  Button,
  CafeIcon,
  CheckIcon,
  cn,
  FieldError,
  FieldGroup,
  MedicalSuppliesIcon,
  PharmacyIcon,
  PhoneIcon,
  ProduceIcon,
  RestaurantIcon,
  ShirtIcon,
  SparklesIcon,
  StoreIcon,
  SupermarketIcon,
  Switch,
  TextField,
  ToggleChip,
  WholesaleIcon,
  type Icon,
} from '@serva/ui';
import { useForm } from '../../lib/useForm';
import { saveCurrency, saveProfile } from './api';
import { FailedNote, SavedNote, SettingsCard, type SettingsSection } from './parts';

/** The icon of each activity, from tab 14 › أيقونة كل نشاط */
export const SECTOR_ICONS: Record<SectorKey, Icon> = {
  clothing: ShirtIcon,
  supermarket: SupermarketIcon,
  restaurant: RestaurantIcon,
  cafe: CafeIcon,
  pharmacy: PharmacyIcon,
  electronics: PhoneIcon,
  bakery: BakeryIcon,
  building_materials: BuildingMaterialsIcon,
  cosmetics: SparklesIcon,
  medical_supplies: MedicalSuppliesIcon,
  produce: ProduceIcon,
  wholesale: WholesaleIcon,
  general: StoreIcon,
};

/**
 * One activity as a big card (the start wizard): the whole card is the checkbox, picked with the
 * brand edge, a soft halo and a ticked box at its end (هوية 4 › ChoiceCard, square for several).
 */
function SectorCard({
  label,
  icon: SectorGlyph,
  checked,
  onChange,
}: {
  label: string;
  icon: Icon;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'group/sector flex min-h-16 cursor-pointer items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-e1 select-none sm:p-4',
        'transition-[border-color,background-color,box-shadow] duration-120 ease-standard hover:border-line-control',
        'has-checked:border-brand has-checked:bg-brand-soft/40 has-checked:ring-4 has-checked:ring-brand/10',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
      )}
    >
      <input
        type="checkbox"
        name="sectors"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <SectorGlyph
        size={24}
        className="text-ink-muted transition-colors duration-120 ease-standard group-has-checked/sector:text-brand-ink"
      />
      <span className="min-w-0 flex-1 font-semibold text-ink">{label}</span>
      <span className="grid size-5 shrink-0 place-items-center rounded-box border border-line-control bg-surface text-on-brand transition-colors duration-120 ease-standard group-hover/sector:border-ink-subtle group-has-checked/sector:border-brand group-has-checked/sector:bg-brand">
        <CheckIcon
          size={16}
          strokeWidth={3}
          className="size-3.5 opacity-0 transition-opacity duration-120 ease-standard group-has-checked/sector:opacity-100"
        />
      </span>
    </label>
  );
}

/**
 * The activities, one or more (04 › ما نشاط محلّك؟): chips inside the settings form, or big cards on
 * the wizard's first step, where the choice is the whole page.
 */
export function SectorPicker({
  value,
  onChange,
  error,
  variant = 'chips',
}: {
  value: SectorKey[];
  onChange: (next: SectorKey[]) => void;
  error?: string;
  variant?: 'chips' | 'cards';
}) {
  const toggle = (key: SectorKey, checked: boolean) =>
    onChange(checked ? [...value, key] : value.filter((k) => k !== key));

  if (variant === 'cards') {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">اختر نشاطاً واحداً أو أكثر</legend>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {SECTORS.map((s) => (
            <SectorCard
              key={s.key}
              label={s.labelAr}
              icon={SECTOR_ICONS[s.key]}
              checked={value.includes(s.key)}
              onChange={(checked) => toggle(s.key, checked)}
            />
          ))}
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </fieldset>
    );
  }

  return (
    <FieldGroup legend="ما نشاط محلّك؟ اختر نشاطاً واحداً أو أكثر" error={error}>
      <div className="flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <ToggleChip
            key={s.key}
            name="sectors"
            label={s.labelAr}
            icon={SECTOR_ICONS[s.key]}
            checked={value.includes(s.key)}
            onChange={(event) => toggle(s.key, event.target.checked)}
          />
        ))}
      </div>
    </FieldGroup>
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

/**
 * The top of the receipt as it will print, while the owner types (04 › معاينة حيّة للإيصال): a
 * slip of paper on a soft stage, its lines centred like a till printer's.
 */
export function ReceiptPreview({ values }: { values: ProfileValues }) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface-muted p-4 sm:p-5">
      <p className="text-xs font-semibold text-ink-subtle">معاينة الإيصال</p>
      <div
        aria-label="معاينة رأس الإيصال"
        className="mx-auto w-full max-w-[17rem] rounded-small border border-line bg-surface px-5 py-6 text-center text-sm leading-relaxed text-ink shadow-e2"
      >
        <p className="text-base font-bold">{values.name || 'اسم المحل'}</p>
        {values.legalName ? <p className="text-xs">{values.legalName}</p> : null}
        {values.address ? <p className="text-xs text-ink-muted">{values.address}</p> : null}
        {values.phone ? (
          <p className="num text-xs text-ink-muted" dir="ltr">
            {values.phone}
          </p>
        ) : null}
        {values.taxNumber ? <p className="text-xs">الرقم الضريبي: {values.taxNumber}</p> : null}
        <p className="my-3 border-t border-dashed border-line-control/50" />
        <p className="text-xs text-ink-subtle">… أسطر الفاتورة …</p>
        <p className="my-3 border-t border-dashed border-line-control/50" />
        <p className="text-xs">{values.receiptFooter || 'شكراً لزيارتكم'}</p>
      </div>
    </div>
  );
}

/** The save button and what sits before it in the bar (a skip button on the wizard). */
function SaveActions({
  submitLabel,
  submitting,
  secondaryAction,
}: {
  submitLabel: string;
  submitting: boolean;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col-reverse max-sm:*:w-full">
      {secondaryAction}
      <Button type="submit" loading={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}

export function ProfileForm({
  store,
  onSaved,
  submitLabel = 'احفظ',
  showSectors = true,
  section,
  secondaryAction,
}: {
  store: StoreResponse;
  onSaved: (store: StoreResponse) => void;
  submitLabel?: string;
  showSectors?: boolean;
  /** The card's title on «إعدادات المتجر»; the wizard's step names the form instead. */
  section?: SettingsSection;
  /** A second button in the save bar, before the save (the wizard's «تخط هذه الخطوة»). */
  secondaryAction?: ReactNode;
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
    <SettingsCard
      section={section}
      label="معلومات المحل"
      formRef={formRef}
      onSubmit={handleSubmit}
      stickyBar
      footer={
        <>
          {formError ? <FailedNote>{formError}</FailedNote> : null}
          {saved ? <SavedNote>حُفظت معلومات المحل.</SavedNote> : null}
          <SaveActions submitLabel={submitLabel} submitting={submitting} secondaryAction={secondaryAction} />
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-5">
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
          <div className="grid gap-5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
              inputClassName="num"
              value={values.phone}
              onChange={(e) => setValue('phone', e.target.value)}
              error={errors.phone}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
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
        </div>
        <div className="lg:sticky lg:top-32 lg:self-start">
          <ReceiptPreview values={values} />
        </div>
      </div>
    </SettingsCard>
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
  section,
  secondaryAction,
}: {
  store: StoreResponse;
  onSaved: (store: StoreResponse) => void;
  submitLabel?: string;
  /** The card's title on «إعدادات المتجر»; the wizard's step names the form instead. */
  section?: SettingsSection;
  /** A second button in the save bar, before the save (the wizard's «تخط هذه الخطوة»). */
  secondaryAction?: ReactNode;
}) {
  const [saved, setSaved] = useState(false);
  const form = useForm<CurrencyValues, StoreCurrencyInput>({
    initialValues: () => ({
      // On only once there is a rate: an empty rate under an on switch would block «احفظ وتابع» for nothing
      usdEnabled: store.enabledCurrencies.includes('USD') && Boolean(store.usdRate),
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
    <SettingsCard
      section={section}
      label="العملة والأسعار"
      formRef={formRef}
      onSubmit={handleSubmit}
      footer={
        <>
          {formError ? <FailedNote>{formError}</FailedNote> : null}
          {saved ? <SavedNote>حُفظت العملة وسعر الصرف.</SavedNote> : null}
          <SaveActions submitLabel={submitLabel} submitting={submitting} secondaryAction={secondaryAction} />
        </>
      }
    >
      <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-surface-muted/60 px-4 py-3">
        <p className="text-sm text-ink-muted">العملة الأساسية، بها تُحسب الحسابات والتقارير</p>
        <p className="font-semibold text-ink">الليرة السورية</p>
      </div>
      <div className="flex flex-col divide-y divide-line">
        <div className="flex flex-col gap-4 pb-4">
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
              hint="مثل 13,000 أو ١٣٠٠٠. تعدّله كلما تغيّر، والفواتير السابقة تبقى بالسعر الذي بيعت به"
              placeholder="13,000"
              inputMode="decimal"
              dir="ltr"
              inputClassName="num"
              endAdornment={<span className="me-3 text-sm">ل.س</span>}
              value={values.usdRate}
              onChange={(e) => setValue('usdRate', e.target.value)}
              error={errors.usdRate}
              className="sm:max-w-xs"
            />
          ) : null}
        </div>
        <div className="pt-4">
          <Switch
            label="أسعار الرفوف تشمل الضريبة"
            description="الشائع في سوريا. إن أطفأته تُضاف الضريبة فوق السعر عند البيع"
            checked={values.taxInclusive}
            onCheckedChange={(checked) => setValue('taxInclusive', checked)}
          />
        </div>
      </div>
    </SettingsCard>
  );
}
