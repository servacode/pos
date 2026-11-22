import { useState, type ReactNode } from 'react';
import type {
  PlatformEnrolDone,
  PlatformEnrolStart,
  PlatformLoginResponse,
  PlatformLoginResult,
} from '@serva/core';
import {
  Alert,
  Button,
  Card,
  IconChip,
  Logo,
  PasswordField,
  ShieldCheckIcon,
  TextField,
  ThemeToggle,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../lib/api';
import { TwoFactorEnrol } from './TwoFactorEnrol';

type Stage =
  | { name: 'password' }
  | { name: 'code'; ticket: string }
  | { name: 'newPassword'; ticket: string }
  | { name: 'enrol'; ticket: string };

const post = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST', body });

/**
 * The platform sign-in (هوية 4): the logo and the theme switch above, and in the middle the panel's
 * name and the form on a card, apart from the stores' own sign-in. After the password the server
 * may ask for more: the code from the authenticator app (or a recovery code), a new password while
 * the first one is still the bootstrap one, and the switching on of two-factor when it is required.
 */
export function PlatformLogin({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [stage, setStage] = useState<Stage>({ name: 'password' });
  const move = (result: PlatformLoginResult) => {
    if (result.step === undefined) return onSignedIn(result.token);
    setStage(
      result.step === 'code'
        ? { name: 'code', ticket: result.ticket }
        : result.step === 'password'
          ? { name: 'newPassword', ticket: result.ticket }
          : { name: 'enrol', ticket: result.ticket },
    );
  };

  return (
    <main className="flex min-h-dvh flex-col px-5 pt-3 pb-10 sm:px-10">
      <header className="flex min-h-12 items-center justify-between gap-4">
        <Logo />
        <ThemeToggle />
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pt-10 pb-6 motion-safe:animate-rise">
        <IconChip size="lg">
          <ShieldCheckIcon size={24} />
        </IconChip>
        <h1 className="mt-5 text-2xl font-bold text-ink sm:text-3xl">لوحة المنصة</h1>
        <p className="mt-2 text-ink-muted">
          {stage.name === 'password'
            ? 'لإدارة سيرفا: المتاجر واشتراكاتها، والدفعات، والباقات.'
            : stage.name === 'code'
              ? 'خطوة أخيرة: اكتب الرمز من تطبيق المصادقة.'
              : stage.name === 'newPassword'
                ? 'كلمة السر الحالية مؤقتة. اختر كلمة سر جديدة قبل المتابعة.'
                : 'تتطلب المنصة التحقق بخطوتين لحسابك. فعّله قبل المتابعة.'}
        </p>
        <Card className="mt-8">
          {stage.name === 'password' ? (
            <PasswordStage onResult={move} />
          ) : stage.name === 'code' ? (
            <CodeStage ticket={stage.ticket} onResult={move} />
          ) : stage.name === 'newPassword' ? (
            <NewPasswordStage ticket={stage.ticket} onResult={move} />
          ) : (
            <TwoFactorEnrol
              begin={() => post<PlatformEnrolStart>('/v1/platform/login/enrol', { ticket: stage.ticket })}
              confirm={(code) =>
                post<PlatformEnrolDone>('/v1/platform/login/enrol/confirm', { ticket: stage.ticket, code })
              }
              onFinished={(done) => {
                if (done.login) onSignedIn(done.login.token);
              }}
              finishLabel="ادخل إلى اللوحة"
            />
          )}
        </Card>
        <p className="mt-6 text-center text-sm text-ink-subtle">تنتهي الجلسة بعد ثماني ساعات من الدخول.</p>
      </div>
    </main>
  );
}

function useStep(run: () => Promise<PlatformLoginResult>, onResult: (r: PlatformLoginResult) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    setBusy(true);
    setError(null);
    run()
      .then(onResult)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  return { error, busy, submit };
}

function StepForm({
  error,
  children,
  onSubmit,
}: {
  error: string | null;
  children: ReactNode;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {children}
    </form>
  );
}

function PasswordStage({ onResult }: { onResult: (r: PlatformLoginResult) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useStep(
    () => post<PlatformLoginResponse | PlatformLoginResult>('/v1/platform/login', { email, password }),
    onResult,
  );
  return (
    <StepForm error={error} onSubmit={submit}>
      <TextField
        label="البريد الإلكتروني"
        type="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordField label="كلمة السر" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" size="lg" fullWidth loading={busy} className="mt-1">
        ادخل
      </Button>
    </StepForm>
  );
}

function CodeStage({ ticket, onResult }: { ticket: string; onResult: (r: PlatformLoginResult) => void }) {
  const [code, setCode] = useState('');
  const { error, busy, submit } = useStep(
    () => post<PlatformLoginResult>('/v1/platform/login/code', { ticket, code }),
    onResult,
  );
  return (
    <StepForm error={error} onSubmit={submit}>
      <TextField
        label="رمز التحقق"
        dir="ltr"
        inputMode="text"
        autoComplete="one-time-code"
        autoFocus
        hint="6 أرقام من التطبيق، أو أحد رموز الاسترداد إن ضاع جوالك."
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" size="lg" fullWidth loading={busy}>
        تحقّق
      </Button>
    </StepForm>
  );
}

function NewPasswordStage({
  ticket,
  onResult,
}: {
  ticket: string;
  onResult: (r: PlatformLoginResult) => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again !== '' && again !== password;
  const { error, busy, submit } = useStep(
    () => post<PlatformLoginResult>('/v1/platform/login/password', { ticket, password }),
    onResult,
  );
  return (
    <StepForm
      error={error ?? (mismatch ? 'كلمتا السر غير متطابقتين.' : null)}
      onSubmit={() => !mismatch && submit()}
    >
      <PasswordField
        label="كلمة السر الجديدة"
        autoComplete="new-password"
        hint="12 حرفاً على الأقل."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <PasswordField
        label="أعد كلمة السر الجديدة"
        autoComplete="new-password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
      />
      <Button type="submit" size="lg" fullWidth loading={busy}>
        حفظ ومتابعة
      </Button>
    </StepForm>
  );
}
