import { loginInput } from '@serva/core';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { useForm } from '../lib/useForm';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';
import { TextLink } from '../ui/TextLink';

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { phone: '', password: '' },
    fieldOrder: ['phone', 'password'],
    validate: (input) => loginInput.safeParse(input),
    onSubmit: async (data) => {
      await login(data);
      navigate('/', { replace: true });
    },
  });
  const sessionExpired = state.status === 'signedOut' && state.reason === 'expired';

  return (
    <AuthLayout
      title="أهلاً بعودتك"
      subtitle="سجّل دخولك وتابع البيع من حيث توقفت."
      footer={
        <>
          ما عندك حساب؟ <TextLink to="/register">افتح متجرك الآن</TextLink>
        </>
      }
    >
      <title>تسجيل الدخول · Serva POS</title>
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {sessionExpired && !formError ? (
          <Alert tone="info">انتهت جلستك. سجّل الدخول مجدداً للمتابعة.</Alert>
        ) : null}
        <TextField
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />
        <PasswordField
          name="password"
          label="كلمة المرور"
          autoComplete="current-password"
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-1">
          دخول
        </Button>
      </form>
    </AuthLayout>
  );
}
