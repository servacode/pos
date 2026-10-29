import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CURRENCIES,
  CURRENCY_CODES,
  SECTORS,
  SECTOR_KEYS,
  registerStoreInput,
  type CurrencyCode,
  type SectorKey,
} from '@serva/core';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { useForm } from '../lib/useForm';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ChoiceCard } from '../ui/ChoiceCard';
import { FieldGroup } from '../ui/FieldGroup';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';
import { TextLink } from '../ui/TextLink';
import { ToggleChip } from '../ui/ToggleChip';

interface RegisterValues {
  storeName: string;
  ownerName: string;
  phone: string;
  password: string;
  sectors: SectorKey[];
  baseCurrency: CurrencyCode;
  agentCode: string;
}

const FIELD_ORDER = [
  'storeName',
  'ownerName',
  'phone',
  'password',
  'sectors',
  'baseCurrency',
  'agentCode',
] as const satisfies readonly (keyof RegisterValues)[];

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [referralCode] = useState(() => searchParams.get('ref')?.trim() ?? '');
  const [agentCodeOpen, setAgentCodeOpen] = useState(referralCode !== '');

  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: (): RegisterValues => ({
      storeName: '',
      ownerName: '',
      phone: '',
      password: '',
      sectors: [],
      baseCurrency: 'SYP',
      agentCode: referralCode,
    }),
    fieldOrder: FIELD_ORDER,
    validate: ({ agentCode, ...rest }) =>
      registerStoreInput.safeParse({ ...rest, agentCode: agentCode.trim() || undefined }),
    onSubmit: async (data) => {
      await register(data);
      navigate('/', { replace: true });
    },
  });

  function toggleSector(key: SectorKey, checked: boolean) {
    setValue(
      'sectors',
      SECTOR_KEYS.filter((k) => (k === key ? checked : values.sectors.includes(k))),
    );
  }

  const showAgentCode = agentCodeOpen || Boolean(errors.agentCode);

  return (
    <AuthLayout
      title="افتح متجرك خلال دقيقة"
      subtitle="معلومات قليلة وتبدأ البيع. تقدر تعدّل كل شيء لاحقاً."
      footer={
        <>
          عندك حساب؟ <TextLink to="/login">سجّل الدخول</TextLink>
        </>
      }
    >
      <title>افتح متجرك · Serva POS</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="storeName"
            label="اسم المتجر"
            placeholder="مثال: سوبرماركت الياسمين"
            autoComplete="organization"
            value={values.storeName}
            onChange={(e) => setValue('storeName', e.target.value)}
            error={errors.storeName}
          />
          <TextField
            name="ownerName"
            label="اسمك"
            placeholder="الاسم الكامل"
            autoComplete="name"
            value={values.ownerName}
            onChange={(e) => setValue('ownerName', e.target.value)}
            error={errors.ownerName}
          />
        </div>

        <TextField
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          hint="ستستخدمه لتسجيل الدخول."
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />

        <PasswordField
          name="password"
          label="كلمة المرور"
          autoComplete="new-password"
          hint="8 أحرف على الأقل."
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />

        <FieldGroup
          legend="نشاط المتجر"
          hint="تقدر تختار أكثر من نشاط، مثل مول فيه مقهى"
          error={errors.sectors}
        >
          <div className="flex flex-wrap gap-2">
            {SECTORS.map((sector) => (
              <ToggleChip
                key={sector.key}
                name="sectors"
                value={sector.key}
                label={sector.labelAr}
                checked={values.sectors.includes(sector.key)}
                onChange={(e) => toggleSector(sector.key, e.target.checked)}
              />
            ))}
          </div>
        </FieldGroup>

        <FieldGroup
          legend="العملة الأساسية"
          hint="الليرة والدولار مفعّلتان دائماً. الأساسية هي التي تظهر بها تقاريرك."
          error={errors.baseCurrency}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {CURRENCY_CODES.map((code) => (
              <ChoiceCard
                key={code}
                name="baseCurrency"
                value={code}
                title={CURRENCIES[code].nameAr}
                description={code}
                leading={CURRENCIES[code].symbolAr}
                checked={values.baseCurrency === code}
                onChange={() => setValue('baseCurrency', code)}
              />
            ))}
          </div>
        </FieldGroup>

        {showAgentCode ? (
          <TextField
            name="agentCode"
            label="كود الوكيل (اختياري)"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={!referralCode}
            hint={referralCode ? 'أضفناه لك من رابط الدعوة.' : 'إذا ساعدك وكيل بالتسجيل، اكتب كوده هنا.'}
            value={values.agentCode}
            onChange={(e) => setValue('agentCode', e.target.value)}
            error={errors.agentCode}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAgentCodeOpen(true)}
            className="-my-2 min-h-11 self-start rounded-sm text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            عندك كود وكيل؟
          </button>
        )}

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {submitting ? 'جارٍ تجهيز متجرك…' : 'افتح متجري'}
        </Button>
      </form>
    </AuthLayout>
  );
}
