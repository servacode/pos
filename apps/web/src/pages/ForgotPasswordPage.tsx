import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  forgotPasswordInput,
  resetPasswordInput,
  type AuthResponse,
  type ForgotPasswordResponse,
} from '@serva/core';
import { Alert, Button, cn, PasswordField, TextField, TextLink, textLinkClass } from '@serva/ui';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { apiFetch, setAccessToken } from '../lib/api';
import { useForm } from '../lib/useForm';
import { CODE_LENGTH, CodeField, TestCodeBox } from './RegisterPage';

interface PendingReset {
  resetId: string;
  phone: string;
  /** The local server's test mode only: the code, shown on screen (no SMS there) */
  testCode?: string | undefined;
}

/**
 * «نسيت كلمة السر»: the phone, then the code sent to it with the new password. The same answer
 * comes back for every number, so this page cannot tell whether a number has an account. Signing
 * in again is automatic once the password is changed; every other session is ended by the server.
 */
export function ForgotPasswordPage() {
  const [pending, setPending] = useState<PendingReset | null>(null);
  return pending ? (
    <ResetStep pending={pending} onChangeNumber={() => setPending(null)} />
  ) : (
    <PhoneStep onCodeSent={setPending} />
  );
}

function PhoneStep({ onCodeSent }: { onCodeSent: (pending: PendingReset) => void }) {
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { phone: '' },
    fieldOrder: ['phone'] as const,
    validate: (input) => forgotPasswordInput.safeParse(input),
    onSubmit: async (data) => {
      const sent = await apiFetch<ForgotPasswordResponse>('/v1/auth/forgot', { method: 'POST', body: data });
      onCodeSent({ resetId: sent.resetId, phone: data.phone, testCode: sent.testCode });
    },
  });

  return (
    <AuthLayout
      title="نسيت كلمة السر؟"
      subtitle="اكتب رقم جوالك ونرسل لك رمزاً تختار به كلمة سر جديدة."
      footer={
        <>
          تذكّرتها؟{' '}
          <TextLink as={Link} to="/login">
            سجّل الدخول
          </TextLink>
        </>
      }
    >
      <title>استعادة كلمة السر · SERFA</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <TextField
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          autoFocus
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-1">
          أرسل الرمز
        </Button>
      </form>
    </AuthLayout>
  );
}

function ResetStep({ pending, onChangeNumber }: { pending: PendingReset; onChangeNumber: () => void }) {
  const { refreshMe } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');

  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { code: '', password: '' },
    fieldOrder: ['code', 'password'] as const,
    validate: (input) => {
      const result = resetPasswordInput.safeParse({ resetId: pending.resetId, ...input });
      if (!result.success || input.password === confirm) return result;
      return {
        success: false as const,
        error: { issues: [{ path: ['password'], message: 'كلمتا السر غير متطابقتين.' }] },
      };
    },
    onSubmit: async (data) => {
      const auth = await apiFetch<AuthResponse>('/v1/auth/forgot/reset', { method: 'POST', body: data });
      setAccessToken(auth.accessToken);
      await refreshMe();
      navigate('/', { replace: true });
    },
  });

  return (
    <AuthLayout
      title="اختر كلمة سر جديدة"
      // The number is isolated (LRI…PDI) so it keeps its order inside the Arabic sentence.
      subtitle={`إن كان للرقم ⁦${pending.phone}⁩ حساب فقد أرسلنا إليه رمزاً. اكتبه هنا مع كلمة السر الجديدة.`}
      footer={
        <>
          أخطأت في الرقم؟{' '}
          <button type="button" onClick={onChangeNumber} className={cn(textLinkClass, 'min-h-11')}>
            تعديل الرقم
          </button>
        </>
      }
    >
      <title>كلمة سر جديدة · SERFA</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {pending.testCode ? (
          <TestCodeBox code={pending.testCode} onFill={() => setValue('code', pending.testCode ?? '')} />
        ) : null}
        <CodeField
          name="code"
          label="رمز التحقق"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={CODE_LENGTH}
          hint="6 أرقام، صالح لعشر دقائق."
          value={values.code}
          onChange={(e) => setValue('code', e.target.value)}
          error={errors.code}
        />
        <PasswordField
          name="password"
          label="كلمة السر الجديدة"
          autoComplete="new-password"
          hint="8 أحرف على الأقل."
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />
        <PasswordField
          name="confirm"
          label="أعد كلمة السر الجديدة"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          تغيير كلمة السر ودخول
        </Button>
        <p className="text-center text-sm text-ink-subtle">
          عند التغيير تنتهي جلسات هذا الحساب على الأجهزة الأخرى.
        </p>
      </form>
    </AuthLayout>
  );
}
