import { Fragment, useId, useState, type ComponentProps, type SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  TERMS_VERSION,
  registerStoreInput,
  registrationCodeInput,
  type AuthResponse,
  type RegisterResponse,
  type RegisterStoreData,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  Checkbox,
  CheckIcon,
  cn,
  CONTROL_HEIGHT,
  FieldError,
  PasswordField,
  TextField,
  TextLink,
  textLinkClass,
  WarningIcon,
} from '@serva/ui';
import { useAuth } from '../auth/useAuth';
import { AuthLayout } from '../layout/AuthLayout';
import { apiFetch, setAccessToken } from '../lib/api';
import { useForm } from '../lib/useForm';

interface RegisterValues {
  phone: string;
  fullName: string;
  password: string;
  agentCode: string;
  /** The terms and the privacy policy, ticked by the owner (24-legal: an explicit tick, not a footnote) */
  agreed: boolean;
}

const FIELD_ORDER = [
  'phone',
  'fullName',
  'password',
  'agentCode',
  'agreed',
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
    initialValues: (): RegisterValues => ({
      phone: '',
      fullName: '',
      password: '',
      agentCode: referralCode,
      agreed: false,
    }),
    fieldOrder: FIELD_ORDER,
    validate: ({ agentCode, agreed, ...rest }) => {
      const result = registerStoreInput.safeParse({
        ...rest,
        agentCode: agentCode.trim() || undefined,
        termsVersion: TERMS_VERSION,
      });
      if (agreed) return result;
      const notAgreed = { path: ['agreed'], message: 'وافق على الشروط وسياسة الخصوصية لتفتح الحساب.' };
      return { success: false as const, error: { issues: [...(result.error?.issues ?? []), notAgreed] } };
    },
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
  const agreedErrorId = useId();

  return (
    <AuthLayout
      title="افتح متجرك خلال دقيقة"
      subtitle="ثلاث معلومات وتبدأ. يمكنك تعديل كل شيء لاحقاً."
      steps={<RegisterSteps current={0} />}
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
          // Ghost, pulled to the labels' edge: its words line up with the fields above it.
          <Button
            variant="ghost"
            size="sm"
            icon={<AddIcon size={16} />}
            onClick={() => setAgentCodeOpen(true)}
            className="-my-1 -ms-3.5 self-start"
          >
            لديك كود وكيل؟
          </Button>
        )}

        <div className="flex flex-col gap-1">
          <Checkbox
            name="agreed"
            checked={values.agreed}
            onChange={(e) => setValue('agreed', e.target.checked)}
            aria-invalid={errors.agreed ? true : undefined}
            aria-describedby={errors.agreed ? agreedErrorId : undefined}
            label={
              <>
                أوافق على{' '}
                <TextLink href="/terms" target="_blank" rel="noopener">
                  الشروط
                </TextLink>{' '}
                و
                <TextLink href="/privacy" target="_blank" rel="noopener">
                  سياسة الخصوصية
                </TextLink>
              </>
            }
          />
          {errors.agreed ? <FieldError id={agreedErrorId}>{errors.agreed}</FieldError> : null}
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            {submitting ? 'جارٍ إرسال الرمز…' : 'افتح متجري'}
          </Button>
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
      steps={<RegisterSteps current={1} />}
      footer={
        <>
          أخطأت في الرقم؟{' '}
          <button type="button" onClick={onChangeNumber} className={cn(textLinkClass, 'min-h-11')}>
            تعديل الرقم
          </button>
        </>
      }
    >
      <title>رمز التحقق · Serva POS</title>
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
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {submitting ? 'جارٍ تجهيز متجرك…' : 'تأكيد وفتح المتجر'}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * The three steps of opening a store: the owner's details and the code here, then the store's setup
 * (business type and currency), which the setup wizard asks right after.
 */
const STEPS = ['بياناتك', 'رمز التحقق', 'تجهيز المتجر'] as const;

function RegisterSteps({ current }: { current: number }) {
  return (
    <ol aria-label="خطوات فتح المتجر" className="mb-8 grid grid-cols-3 gap-2">
      {STEPS.map((step, index) => {
        const done = index < current;
        const here = index === current;
        return (
          <li key={step} aria-current={here ? 'step' : undefined} className="flex min-w-0 flex-col gap-2.5">
            <span
              aria-hidden="true"
              className={cn('h-1 rounded-full', done || here ? 'bg-brand' : 'bg-line')}
            />
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs font-semibold',
                here ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-subtle',
              )}
            >
              {done ? (
                <CheckIcon size={16} className="text-brand-ink" />
              ) : (
                <span className="num">{index + 1}</span>
              )}
              <span className="truncate">{step}</span>
              {done ? <span className="sr-only">(تمّت)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export const CODE_LENGTH = 6;

interface CodeFieldProps extends Omit<ComponentProps<'input'>, 'value' | 'size' | 'className'> {
  label: string;
  value: string;
  hint?: string;
  error?: string;
}

/** A digit's box: the field's skin (هوية 4 › الحقول) at the touch density's height, the digit large. */
const CODE_BOX =
  'grid min-w-0 flex-1 place-items-center rounded-control border bg-surface text-2xl font-bold text-ink num transition-[border-color,box-shadow] duration-120 ease-standard';

/** The box the next digit goes in carries the focus halo while the field has the focus. */
function codeBoxTone(error: boolean, next: boolean): string {
  if (error) {
    return cn('border-danger', next && 'group-focus-within:ring-4 group-focus-within:ring-danger/15');
  }
  return cn(
    'border-line-control group-hover:border-ink-subtle',
    next &&
      'group-focus-within:border-brand group-focus-within:ring-4 group-focus-within:ring-brand/15 group-focus-within:group-hover:border-brand',
  );
}

/**
 * The boxes show the code from its first digit, so typing and deleting happen at its end, wherever
 * the boxes were clicked. Selecting all of it stays possible, to type or paste a new code over it.
 */
function keepCaretAtEnd(event: SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const end = input.value.length;
  const { selectionStart, selectionEnd } = input;
  const all = selectionStart === 0 && selectionEnd === end;
  if (!all && (selectionStart !== end || selectionEnd !== end)) input.setSelectionRange(end, end);
}

/**
 * The code from the SMS, drawn as six boxes in two threes, as the message writes it. Underneath is
 * one real input: the code is typed, pasted, filled from the phone's suggestion and read by a screen
 * reader as one field, with its label, hint and error like any other.
 */
export function CodeField({ label, value, hint, error, id, ...inputProps }: CodeFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const digits = Array.from(value);
  const next = Math.min(digits.length, CODE_LENGTH - 1);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink-muted">
        {label}
      </label>
      <div className="group relative">
        <input
          {...inputProps}
          id={inputId}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          onSelect={keepCaretAtEnd}
          // Invisible over the boxes: they draw the digits, the halo and the caret.
          className="absolute inset-0 cursor-text rounded-control bg-transparent text-base text-transparent caret-transparent outline-hidden selection:bg-transparent autofill:shadow-[inset_0_0_0_1000px_var(--color-surface)]"
        />
        <div aria-hidden="true" dir="ltr" className="pointer-events-none relative flex items-center gap-2">
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <Fragment key={index}>
              {index === CODE_LENGTH / 2 ? (
                <span className="h-0.5 w-2.5 shrink-0 rounded-full bg-line-control" />
              ) : null}
              <span
                className={cn(CODE_BOX, CONTROL_HEIGHT.touch, codeBoxTone(Boolean(error), index === next))}
              >
                {digits[index] ??
                  (index === next ? (
                    <span className="h-6 w-0.5 rounded-full bg-brand opacity-0 group-focus-within:opacity-100 motion-safe:group-focus-within:animate-pulse" />
                  ) : null)}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The local server's test mode: there is no SMS there, so the code is shown here, clearly marked
 * as a test, with a button that types it in.
 */
export function TestCodeBox({ code, onFill }: { code: string; onFill: () => void }) {
  // "123 456", isolated (LRI…PDI) so the digits keep their order inside the Arabic sentence.
  const spaced = `⁦${code.slice(0, 3)} ${code.slice(3)}⁩`;
  return (
    <div
      role="note"
      aria-label="وضع التجربة"
      className="flex items-center justify-between gap-3 rounded-card border border-warning/20 bg-warning-soft py-3 ps-4 pe-3 text-warning-ink"
    >
      <p className="flex min-w-0 items-start gap-2.5 text-sm font-semibold">
        <WarningIcon className="mt-0.5" />
        {/* One sentence for screen readers; the code drawn large on its own line. */}
        <span>
          وضع التجربة — الرمز: <span className="num block text-xl font-bold tracking-wider">{spaced}</span>
        </span>
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={onFill}>
        املأ الرمز
      </Button>
    </div>
  );
}
