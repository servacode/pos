import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  TERMS_VERSION,
  registerStoreInput,
  registrationCodeInput,
  type AuthResponse,
  type RegisterResponse,
  type RegisterStoreData,
} from '@serva/core';
import { Alert, Button, PasswordField, TextField, TextLink } from '@serva/ui';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { apiFetch, setAccessToken } from '../lib/api';
import { useForm } from '../lib/useForm';

interface RegisterValues {
  phone: string;
  fullName: string;
  password: string;
  agentCode: string;
}

const FIELD_ORDER = [
  'phone',
  'fullName',
  'password',
  'agentCode',
] as const satisfies readonly (keyof RegisterValues)[];

interface PendingCode {
  registrationId: string;
  phone: string;
  password: string;
  /** The local server's test mode only: the code, shown on screen (no SMS there) */
  testCode?: string;
}

/**
 * Opening an account (04, 12): phone, name and password, an optional agent code, then the code sent
 * to the phone. The store is created only once the code is confirmed; business type and currency
 * are asked afterwards by the setup wizard.
 */
export function RegisterPage() {
  const [pending, setPending] = useState<PendingCode | null>(null);
  return pending ? (
    <CodeStep pending={pending} onChangeNumber={() => setPending(null)} />
  ) : (
    <DetailsStep onCodeSent={setPending} />
  );
}

function DetailsStep({ onCodeSent }: { onCodeSent: (pending: PendingCode) => void }) {
  const [searchParams] = useSearchParams();
  const [referralCode] = useState(() => searchParams.get('ref')?.trim() ?? '');
  const [agentCodeOpen, setAgentCodeOpen] = useState(referralCode !== '');

  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: (): RegisterValues => ({ phone: '', fullName: '', password: '', agentCode: referralCode }),
    fieldOrder: FIELD_ORDER,
    validate: ({ agentCode, ...rest }) =>
      registerStoreInput.safeParse({
        ...rest,
        agentCode: agentCode.trim() || undefined,
        termsVersion: TERMS_VERSION,
      }),
    onSubmit: async (data: RegisterStoreData) => {
      const sent = await apiFetch<RegisterResponse>('/v1/auth/register', { method: 'POST', body: data });
      onCodeSent({
        registrationId: sent.registrationId,
        phone: data.phone,
        password: data.password,
        testCode: sent.testCode,
      });
    },
  });

  const showAgentCode = agentCodeOpen || Boolean(errors.agentCode);

  return (
    <AuthLayout
      title="افتح متجرك خلال دقيقة"
      subtitle="ثلاث معلومات وتبدأ. يمكنك تعديل كل شيء لاحقاً."
      footer={
        <>
          لديك حساب؟{' '}
          <TextLink as={Link} to="/login">
            سجّل الدخول
          </TextLink>
        </>
      }
    >
      <title>افتح متجرك · Serva POS</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <TextField
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          hint="سنرسل إليه رمز تحقق، وتدخل به لاحقاً."
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />

        <TextField
          name="fullName"
          label="اسمك"
          placeholder="الاسم الكامل"
          autoComplete="name"
          value={values.fullName}
          onChange={(e) => setValue('fullName', e.target.value)}
          error={errors.fullName}
        />

        <PasswordField
          name="password"
          label="كلمة السر"
          autoComplete="new-password"
          hint="8 أحرف على الأقل."
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />

        {showAgentCode ? (
          <TextField
            name="agentCode"
            label="كود الوكيل (اختياري)"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={!referralCode}
            hint={referralCode ? 'أضفناه من رابط الدعوة.' : 'إذا ساعدك وكيل في التسجيل، اكتب كوده هنا.'}
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
            لديك كود وكيل؟
          </button>
        )}

        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            {submitting ? 'جارٍ إرسال الرمز…' : 'افتح متجري'}
          </Button>
          <p className="text-center text-sm text-ink-muted">بفتح الحساب توافق على الشروط وسياسة الخصوصية.</p>
        </div>
      </form>
    </AuthLayout>
  );
}

function CodeStep({ pending, onChangeNumber }: { pending: PendingCode; onChangeNumber: () => void }) {
  const { refreshMe } = useAuth();
  const navigate = useNavigate();

  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { code: '' },
    fieldOrder: ['code'] as const,
    validate: (current) => registrationCodeInput.safeParse(current),
    onSubmit: async ({ code }) => {
      const auth = await apiFetch<AuthResponse>('/v1/auth/register/verify', {
        method: 'POST',
        body: { registrationId: pending.registrationId, code, password: pending.password },
      });
      setAccessToken(auth.accessToken);
      await refreshMe();
      navigate('/', { replace: true });
    },
  });

  return (
    <AuthLayout
      title="أدخل رمز التحقق"
      // The number is isolated (LRI…PDI) so it keeps its order inside the Arabic sentence.
      subtitle={`أرسلنا رمزاً إلى \u2066${pending.phone}\u2069. يُنشأ متجرك بعد تأكيده.`}
      footer={
        <button
          type="button"
          onClick={onChangeNumber}
          className="min-h-11 rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          تعديل الرقم
        </button>
      }
    >
      <title>رمز التحقق · Serva POS</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {pending.testCode ? (
          <TestCodeBox code={pending.testCode} onFill={() => setValue('code', pending.testCode ?? '')} />
        ) : null}
        <TextField
          name="code"
          label="رمز التحقق"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          hint="6 أرقام، صالح لعشر دقائق."
          value={values.code}
          onChange={(e) => setValue('code', e.target.value)}
          error={errors.code}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {submitting ? 'جارٍ تجهيز متجرك…' : 'تأكيد وفتح المتجر'}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * The local server's test mode: there is no SMS there, so the code is shown here, clearly marked
 * as a test, with a button that types it in.
 */
function TestCodeBox({ code, onFill }: { code: string; onFill: () => void }) {
  // "123 456", isolated (LRI…PDI) so the digits keep their order inside the Arabic sentence.
  const spaced = `⁦${code.slice(0, 3)} ${code.slice(3)}⁩`;
  return (
    <div
      role="note"
      aria-label="وضع التجربة"
      className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-warning-ink"
    >
      <p className="font-semibold">
        وضع التجربة — الرمز: <span className="text-lg tabular-nums">{spaced}</span>
      </p>
      <Button type="button" variant="secondary" size="md" onClick={onFill}>
        املأ الرمز
      </Button>
    </div>
  );
}
