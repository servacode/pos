import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { forgotPasswordInput, resetPasswordFormInput, type ForgotPasswordResponse } from '@serva/core';
import { Alert, Button, LockIcon, PasswordField, PhoneIcon, TextField, TextLink } from '@serva/ui';
import { AuthLayout } from '../layout/AuthLayout';
import { apiFetch } from '../lib/api';
import { useForm } from '../lib/useForm';
import { FieldIcon, StepBadge, TestCodeBox, authField, codeInputClass } from './authParts';

interface PendingReset {
  resetId: string;
  phone: string;
  testCode?: string;
}

/**
 * «نسيت كلمة السر»: the phone of the account, then the code sent to it with the new password.
 * Changing it signs the account out of every device; the person then signs in with the new one.
 */
export function ForgotPasswordPage() {
  const [pending, setPending] = useState<PendingReset | null>(null);
  return pending ? (
    <ResetStep pending={pending} onChangeNumber={() => setPending(null)} onResent={setPending} />
  ) : (
    <PhoneStep onCodeSent={setPending} />
  );
}

const backToLogin = (
  <>
    تذكّرتها؟{' '}
    <TextLink as={Link} to="/login">
      عُد إلى تسجيل الدخول
    </TextLink>
  </>
);

function PhoneStep({ onCodeSent }: { onCodeSent: (pending: PendingReset) => void }) {
  const location = useLocation();
  const typed = (location.state as { phone?: string } | null)?.phone ?? '';
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { phone: typed },
    fieldOrder: ['phone'] as const,
    validate: (input) => forgotPasswordInput.safeParse(input),
    onSubmit: async (data) => {
      const sent = await apiFetch<ForgotPasswordResponse>('/v1/auth/password/forgot', {
        method: 'POST',
        body: data,
      });
      onCodeSent({ resetId: sent.resetId, phone: data.phone, testCode: sent.testCode });
    },
  });

  return (
    <AuthLayout
      pageTitle="نسيت كلمة السر · Serva POS"
      eyebrow={<StepBadge step={1} of={2} label="رقم الجوال" />}
      title="نسيت كلمة السر؟"
      subtitle="اكتب رقم الجوال الذي تدخل به، ونرسل إليه رمزاً لتغيير كلمة السر."
      footer={backToLogin}
    >
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <TextField
          {...authField}
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          autoFocus
          startAdornment={
            <FieldIcon>
              <PhoneIcon />
            </FieldIcon>
          }
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {submitting ? 'جارٍ إرسال الرمز…' : 'أرسل الرمز'}
        </Button>
      </form>
    </AuthLayout>
  );
}

function ResetStep({
  pending,
  onChangeNumber,
  onResent,
}: {
  pending: PendingReset;
  onChangeNumber: () => void;
  onResent: (pending: PendingReset) => void;
}) {
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { code: '', password: '' },
    fieldOrder: ['code', 'password'] as const,
    validate: (current) => resetPasswordFormInput.safeParse(current),
    onSubmit: async ({ code, password }) => {
      await apiFetch<void>('/v1/auth/password/reset', {
        method: 'POST',
        body: { resetId: pending.resetId, code, password },
      });
      navigate('/login', { replace: true, state: { passwordChanged: true } });
    },
  });

  async function resend() {
    setResending(true);
    setResendError(null);
    try {
      const sent = await apiFetch<ForgotPasswordResponse>('/v1/auth/password/forgot', {
        method: 'POST',
        body: { phone: pending.phone },
      });
      onResent({ resetId: sent.resetId, phone: pending.phone, testCode: sent.testCode });
      setResent(true);
    } catch (error) {
      setResent(false);
      setResendError(error instanceof Error ? error.message : 'تعذّر إرسال الرمز. حاول بعد قليل.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      pageTitle="كلمة سر جديدة · Serva POS"
      eyebrow={<StepBadge step={2} of={2} label="الرمز وكلمة السر" />}
      title="اختر كلمة سر جديدة"
      // The number is isolated (LRI…PDI) so it keeps its order inside the Arabic sentence.
      subtitle={`إن كان للرقم ⁦${pending.phone}⁩ حساب، فقد وصله رمز من 6 أرقام.`}
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
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {resendError && !formError ? <Alert tone="error">{resendError}</Alert> : null}
        {resent && !formError ? <Alert tone="success">أرسلنا رمزاً جديداً.</Alert> : null}
        {pending.testCode ? (
          <TestCodeBox code={pending.testCode} onFill={() => setValue('code', pending.testCode ?? '')} />
        ) : null}
        <TextField
          {...authField}
          name="code"
          inputClassName={codeInputClass}
          label="رمز التحقق"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          hint="صالح لعشر دقائق."
          value={values.code}
          onChange={(e) => setValue('code', e.target.value)}
          error={errors.code}
        />
        <PasswordField
          {...authField}
          name="password"
          label="كلمة السر الجديدة"
          autoComplete="new-password"
          hint="8 أحرف على الأقل. ستخرج من كل الأجهزة بعد تغييرها."
          startAdornment={
            <FieldIcon>
              <LockIcon />
            </FieldIcon>
          }
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />
        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            {submitting ? 'جارٍ الحفظ…' : 'احفظ كلمة السر'}
          </Button>
          <Button type="button" variant="ghost" fullWidth loading={resending} onClick={resend}>
            لم يصلك الرمز؟ أرسله مرة أخرى
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
