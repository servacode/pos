import { loginInput } from '@serva/core';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  KeyIcon,
  LockIcon,
  NextIcon,
  PasswordField,
  PhoneIcon,
  StoreIcon,
  TextField,
  TextLink,
} from '@serva/ui';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { useForm } from '../lib/useForm';
import { FieldIcon, authField } from './authParts';

export function LoginPage() {
  const { state, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const passwordChanged = (location.state as { passwordChanged?: boolean } | null)?.passwordChanged === true;
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm({
    initialValues: { phone: '', password: '', remember: true },
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
      pageTitle="تسجيل الدخول · Serva POS"
      eyebrow={<SignInAs />}
      title="أهلاً بعودتك"
      subtitle="سجّل دخولك وتابع البيع من حيث توقفت."
      footer={
        <>
          ليس لديك حساب؟{' '}
          <TextLink as={Link} to="/register">
            افتح متجرك مجاناً
          </TextLink>
        </>
      }
    >
      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        {passwordChanged && !formError ? (
          <Alert tone="success">تغيّرت كلمة السر. ادخل بها الآن.</Alert>
        ) : null}
        {sessionExpired && !formError && !passwordChanged ? (
          <Alert tone="info">انتهى دخولك. سجّل الدخول مرة أخرى.</Alert>
        ) : null}
        <TextField
          {...authField}
          name="phone"
          label="رقم الجوال"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="09xxxxxxxx"
          startAdornment={
            <FieldIcon>
              <PhoneIcon />
            </FieldIcon>
          }
          value={values.phone}
          onChange={(e) => setValue('phone', e.target.value)}
          error={errors.phone}
        />
        <PasswordField
          {...authField}
          name="password"
          label="كلمة السر"
          autoComplete="current-password"
          startAdornment={
            <FieldIcon>
              <LockIcon />
            </FieldIcon>
          }
          value={values.password}
          onChange={(e) => setValue('password', e.target.value)}
          error={errors.password}
        />
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-4">
          <Checkbox
            name="remember"
            label="تذكّرني على هذا الجهاز"
            checked={values.remember}
            onChange={(e) => setValue('remember', e.target.checked)}
          />
          <TextLink as={Link} to="/forgot-password" state={{ phone: values.phone }} className="text-sm">
            نسيت كلمة السر؟
          </TextLink>
        </div>
        <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-1 shadow-e2">
          دخول
          {submitting ? null : <NextIcon />}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Who is signing in: the owner or a manager here, with phone and password; a cashier on the till,
 * with the staff PIN. The second goes to the cashier screen.
 */
function SignInAs() {
  const item =
    'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.75rem] text-sm font-semibold transition-colors';
  return (
    <nav aria-label="نوع الدخول" className="flex gap-1 rounded-control bg-surface-muted p-1">
      <span aria-current="page" className={`${item} bg-surface text-ink shadow-e1`}>
        <StoreIcon size={20} />
        صاحب المتجر
      </span>
      <Link to="/pos" className={`${item} text-ink-muted hover:text-ink`}>
        <KeyIcon size={20} />
        موظف على الكاشير
      </Link>
    </nav>
  );
}
