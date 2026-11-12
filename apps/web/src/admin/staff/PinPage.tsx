import { useState } from 'react';
import { Alert, Button, Card, IconChip, KeyIcon, LockIcon, PasswordField, TextField } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError } from '../../lib/api';
import { useForm, type ValidationResult } from '../../lib/useForm';
import { setMyPin, type SetPinInput } from './api';
import { needsSixDigits, pinDigits, pinProblem } from './pin';

interface PinValues {
  pin: string;
  confirm: string;
  password: string;
}

const EMPTY: PinValues = { pin: '', confirm: '', password: '' };

function validate(values: PinValues, sixDigits: boolean): ValidationResult<SetPinInput> {
  const issues: { path: string[]; message: string }[] = [];
  const problem = pinProblem(values.pin, sixDigits);
  if (problem) issues.push({ path: ['pin'], message: problem });
  else if (pinDigits(values.confirm) !== pinDigits(values.pin)) {
    issues.push({ path: ['confirm'], message: 'الرمزان غير متطابقين. أعد كتابته' });
  }
  if (!values.password) issues.push({ path: ['password'], message: 'اكتب كلمة السر' });
  if (issues.length > 0) return { success: false, error: { issues } };
  return { success: true, data: { pin: pinDigits(values.pin), password: values.password } };
}

/**
 * «رمز الدخول للكاشير» (16 › تخمين رمز PIN; step 4 brief): the signed-in user sets the code they
 * type on the cashier's keypad, twice, with their password. It says why it is 4 or 6 digits.
 */
export function PinPage() {
  const me = useMe();
  const sixDigits = needsSixDigits(me);
  const [saved, setSaved] = useState(false);
  const { formRef, values, setValue, errors, formError, submitting, handleSubmit } = useForm<
    PinValues,
    SetPinInput
  >({
    initialValues: EMPTY,
    fieldOrder: ['pin', 'confirm', 'password'],
    validate: (v) => validate(v, sixDigits),
    onSubmit: async (input) => {
      setSaved(false);
      try {
        await setMyPin(input);
      } catch (error) {
        // A wrong password belongs under the password field, whatever the code says.
        if (error instanceof ApiError && error.code === 'invalid_credentials') {
          throw new ApiError(error.status, error.code, error.message, { password: error.message });
        }
        throw error;
      }
      setValue('pin', '');
      setValue('confirm', '');
      setValue('password', '');
      setSaved(true);
    },
  });

  const length = sixDigits ? 6 : 4;
  const pinInput = {
    type: 'password',
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    dir: 'ltr' as const,
    maxLength: 6,
    inputClassName: 'num tracking-[0.3em]',
  };

  return (
    <AppShell>
      <title>رمز الدخول للكاشير · SERFA</title>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-2 sm:pt-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <IconChip size="lg">
            <KeyIcon size={24} />
          </IconChip>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold text-ink">رمز الدخول للكاشير</h1>
            <p className="text-ink-muted">تكتبه على أجهزة الكاشير لتدخل باسمك، بدل كلمة السر.</p>
          </div>
        </div>

        <Card className="flex flex-col gap-6">
          <Alert tone="info" title={sixDigits ? 'رمزك 6 أرقام.' : 'رمزك 4 أرقام أو 6.'}>
            الكاشير يكفيه 4 أرقام. المالك والمدير ومن يوافق على خصم أو إرجاع أو سحب نقد يحتاج 6 أرقام، لأن
            رمزه يفتح عمليات غيره.
          </Alert>

          {saved ? (
            <Alert tone="success">
              حُفظ رمز الدخول. استعمله على أجهزة الكاشير من الآن، والرمز القديم لم يعد يعمل.
            </Alert>
          ) : null}
          {formError ? <Alert tone="error">{formError}</Alert> : null}

          <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                {...pinInput}
                name="pin"
                label="رمز الدخول الجديد"
                hint={sixDigits ? '6 أرقام' : '4 أرقام أو 6'}
                placeholder={'•'.repeat(length)}
                value={values.pin}
                onChange={(event) => setValue('pin', event.target.value)}
                error={errors.pin}
              />
              <TextField
                {...pinInput}
                name="confirm"
                label="أعد كتابة الرمز"
                placeholder={'•'.repeat(length)}
                value={values.confirm}
                onChange={(event) => setValue('confirm', event.target.value)}
                error={errors.confirm}
              />
            </div>
            <PasswordField
              name="password"
              label="كلمة السر"
              hint="للتأكد أنك صاحب الحساب."
              autoComplete="current-password"
              value={values.password}
              onChange={(event) => setValue('password', event.target.value)}
              error={errors.password}
            />
            <Button type="submit" size="lg" icon={<KeyIcon />} loading={submitting} fullWidth>
              احفظ الرمز
            </Button>
          </form>
        </Card>

        <p className="flex items-start gap-2 px-1 text-sm text-ink-muted">
          <LockIcon size={16} className="mt-0.5 text-ink-subtle" />
          لا تختر أرقاماً متتالية مثل 1234 ولا مكررة مثل 0000. بعد 5 محاولات خاطئة يُقفل الجهاز دقيقة، وتتضاعف
          المدة مع كل خطأ بعدها.
        </p>
      </div>
    </AppShell>
  );
}
