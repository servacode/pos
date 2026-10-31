import { useState } from 'react';
import { Alert, Button, Card, InfoIcon, KeyIcon, PasswordField, TextField } from '@serva/ui';
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
      <title>رمز الدخول للكاشير · Serva POS</title>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink">رمز الدخول للكاشير</h1>
          <p className="text-ink-muted">تكتبه على أجهزة الكاشير لتدخل باسمك، بدل كلمة السر.</p>
        </div>

        <Card className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-ink">
            <InfoIcon className="mt-1 text-info-ink" />
            <span>
              الكاشير يكفيه 4 أرقام. المالك والمدير ومن يوافق على خصم أو إرجاع أو سحب نقد يحتاج 6 أرقام، لأن
              رمزه يفتح عمليات غيره.
            </span>
          </p>
          <p className="font-semibold text-ink">{sixDigits ? 'رمزك 6 أرقام.' : 'رمزك 4 أرقام أو 6.'}</p>
          <p className="text-sm text-ink-muted">
            لا تختر أرقاماً متتالية مثل 1234 ولا مكررة مثل 0000. بعد 5 محاولات خاطئة يُقفل الجهاز دقيقة،
            وتتضاعف المدة مع كل خطأ بعدها.
          </p>
        </Card>

        {saved ? (
          <Alert tone="success">
            حُفظ رمز الدخول. استعمله على أجهزة الكاشير من الآن، والرمز القديم لم يعد يعمل.
          </Alert>
        ) : null}
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <Card>
          <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            <PasswordField
              name="password"
              label="كلمة السر"
              hint="للتأكد أنك صاحب الحساب."
              autoComplete="current-password"
              value={values.password}
              onChange={(event) => setValue('password', event.target.value)}
              error={errors.password}
            />
            <Button
              type="submit"
              icon={<KeyIcon />}
              loading={submitting}
              className="self-start max-sm:w-full"
            >
              احفظ الرمز
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
