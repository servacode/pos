import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AgentActivation,
  AgentCodeStep,
  AgentLedgerRow,
  AgentLoginResponse,
  AgentMe,
  AgentPlanPrice,
  AgentStore,
  BillingCycle,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CashIcon,
  Dialog,
  EmptyState,
  IconChip,
  ListIcon,
  LogoutIcon,
  Logo,
  Money,
  PasswordField,
  PhoneIcon,
  SegmentedControl,
  Select,
  SendIcon,
  ShieldCheckIcon,
  Skeleton,
  StoreIcon,
  TextField,
  ThemeToggle,
  type BadgeTone,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../lib/api';
import { internationalDigits, whatsappLink } from '../lib/phoneLinks';

/**
 * The agent portal (07 › برنامج الوكلاء › لوحة الوكيل), apart from the stores and the platform: his
 * own sign-in, then his balance, his stores and where each one stands, and one button to activate or
 * renew a store's paid plan from his balance. He sees no store's sales or numbers, only its
 * subscription. Made for a phone first.
 */

const TOKEN_KEY = 'servaAgentToken';
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const keepToken = (token: string | null) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private window: the session lasts as long as the page
  }
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');
const DAY_MS = 86_400_000;
const daysUntil = (iso: string | null) =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS) : null;
const requestKey = () => `agt-${crypto.randomUUID()}`;
const CYCLE_TEXT: Record<BillingCycle, string> = { monthly: 'شهري', yearly: 'سنوي' };

type StateName = 'trial' | 'active' | 'late' | 'stopped' | 'none';
const STATE: Record<StateName, { text: string; tone: BadgeTone }> = {
  trial: { text: 'تجربة مجانية', tone: 'info' },
  active: { text: 'مشترك', tone: 'success' },
  late: { text: 'متأخر عن الدفع', tone: 'warning' },
  stopped: { text: 'للقراءة فقط', tone: 'danger' },
  none: { text: 'بلا اشتراك', tone: 'neutral' },
};
function stateOf(store: AgentStore): StateName {
  if (store.tenantStatus === 'suspended') return 'stopped';
  switch (store.status) {
    case 'trialing':
      return 'trial';
    case 'active':
      return 'active';
    case 'past_due':
      return 'late';
    case 'suspended':
    case 'cancelled':
      return 'stopped';
    default:
      return 'none';
  }
}

export function AgentApp() {
  const [token, setToken] = useState<string | null>(readToken);
  const signOut = useCallback(() => {
    keepToken(null);
    setToken(null);
  }, []);
  return (
    <div dir="rtl" className="min-h-dvh bg-canvas">
      <title>لوحة الوكيل · Serva</title>
      {token ? (
        <Portal token={token} onSignOut={signOut} />
      ) : (
        <Login
          onSignedIn={(r) => {
            keepToken(r.token);
            setToken(r.token);
          }}
        />
      )}
    </div>
  );
}

function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pt-3 pb-10 sm:px-6">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {onSignOut ? (
            <Button variant="ghost" icon={<LogoutIcon />} onClick={onSignOut}>
              اخرج
            </Button>
          ) : null}
        </div>
      </header>
      {children}
    </main>
  );
}

function Login({ onSignedIn }: { onSignedIn: (r: AgentLoginResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Round 37 (decision 21): after the password, a code sent to his phone
  const [step, setStep] = useState<AgentCodeStep | null>(null);
  const [code, setCode] = useState('');
  if (step) {
    return (
      <Shell>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pt-8 pb-6">
          <IconChip size="lg">
            <PhoneIcon size={24} />
          </IconChip>
          <h1 className="mt-5 text-2xl font-bold text-ink sm:text-3xl">رمز التأكيد</h1>
          <p className="mt-2 text-ink-muted">
            أرسلنا رمزاً من ست خانات إلى جوالك الذي ينتهي بـ{' '}
            <bdi dir="ltr" className="num font-semibold text-ink">
              {step.phoneHint}
            </bdi>
            . اكتبه هنا ليكتمل دخولك. يصلح عشر دقائق.
          </p>
          <Card className="mt-8">
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                apiFetch<AgentLoginResponse>('/v1/agent/login/code', {
                  method: 'POST',
                  body: { challengeId: step.challengeId, code },
                })
                  .then(onSignedIn)
                  .catch((err: unknown) => setError(errorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {error ? <Alert tone="error">{error}</Alert> : null}
              {step.testCode ? <Alert tone="info">وضع التجربة: الرمز {step.testCode}</Alert> : null}
              <TextField
                label="الرمز"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <Button type="submit" size="lg" fullWidth loading={busy} disabled={code.length !== 6}>
                أكّد الدخول
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => {
                  setStep(null);
                  setCode('');
                  setError(null);
                }}
              >
                رجوع، أطلب رمزاً جديداً
              </Button>
            </form>
          </Card>
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pt-8 pb-6">
        <IconChip size="lg">
          <ShieldCheckIcon size={24} />
        </IconChip>
        <h1 className="mt-5 text-2xl font-bold text-ink sm:text-3xl">لوحة الوكيل</h1>
        <p className="mt-2 text-ink-muted">ادخل لترى متاجرك وتفعّل اشتراكاتها من رصيدك.</p>
        <Card className="mt-8">
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              apiFetch<AgentCodeStep>('/v1/agent/login', { method: 'POST', body: { email, password } })
                .then((r) => {
                  setStep(r);
                  setCode('');
                })
                .catch((err: unknown) => setError(errorMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            {error ? <Alert tone="error">{error}</Alert> : null}
            <TextField
              label="البريد الإلكتروني"
              type="email"
              dir="ltr"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField
              label="كلمة السر"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" size="lg" fullWidth loading={busy}>
              ادخل
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-sm text-ink-subtle">
          لا تملك حساباً؟ تواصل مع إدارة سيرفا ليفتحوه لك.
        </p>
      </div>
    </Shell>
  );
}

function useAgent(token: string, onSignOut: () => void) {
  return useCallback(
    async <T,>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, { ...init, authorization: `Bearer ${token}` });
      } catch (e) {
        if ((e as { status?: number }).status === 401) onSignOut();
        throw e;
      }
    },
    [token, onSignOut],
  );
}
type Call = ReturnType<typeof useAgent>;

function Portal({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const call = useAgent(token, onSignOut);
  const [me, setMe] = useState<AgentMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadMe = useCallback(() => {
    call<AgentMe>('/v1/agent/me')
      .then(setMe)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [call]);
  useEffect(loadMe, [loadMe]);
  const [tab, setTab] = useState<'stores' | 'ledger'>('stores');

  if (!me) {
    return (
      <Shell onSignOut={onSignOut}>
        {error ? (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        ) : (
          <div aria-hidden="true" className="mt-6 flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </Shell>
    );
  }
  if (me.mustChangePassword) {
    return (
      <Shell onSignOut={onSignOut}>
        <NewPassword call={call} onDone={loadMe} forced={me.mustChangePassword} />
      </Shell>
    );
  }
  return (
    <Shell onSignOut={onSignOut}>
      <div className="mt-4 flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">أهلاً {me.fullName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            كودك{' '}
            <bdi dir="ltr" className="num font-semibold text-ink">
              {me.code}
            </bdi>
            : أعطه لصاحب المحل ليكتبه عند التسجيل فيصير متجره من متاجرك.
          </p>
        </div>
        <Card className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <IconChip size="lg">
              <CashIcon size={24} />
            </IconChip>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-ink-muted">رصيدك المدفوع مسبقاً</span>
              <Money minor={me.balanceMinor} currency="USD" className="text-kpi font-bold text-ink" />
            </div>
          </div>
          <p className="text-xs text-ink-subtle" style={{ maxWidth: '10rem' }}>
            لشحن الرصيد حوّل المبلغ لإدارة سيرفا وستضيفه لك.
          </p>
        </Card>
        <SegmentedControl
          label="القسم"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'stores', label: 'متاجري' },
            { value: 'ledger', label: 'حسابي' },
          ]}
        />
        {tab === 'stores' ? (
          <Stores call={call} me={me} onChanged={loadMe} />
        ) : (
          <Ledger call={call} balance={me.balanceMinor} />
        )}
      </div>
    </Shell>
  );
}

function NewPassword({ call, onDone, forced }: { call: Call; onDone: () => void; forced: boolean }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again !== '' && again !== password;
  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <h1 className="text-2xl font-bold text-ink">اختر كلمة سر لك</h1>
      <p className="mt-2 text-ink-muted">
        {forced
          ? 'كلمة السر التي أعطتك إياها الإدارة مؤقتة. اختر كلمة سر جديدة قبل المتابعة.'
          : 'اختر كلمة سر جديدة.'}
      </p>
      <Card className="mt-6">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (mismatch) return;
            setBusy(true);
            setError(null);
            call('/v1/agent/password', { method: 'PUT', body: { current, password } })
              .then(onDone)
              .catch((err: unknown) => setError(errorMessage(err)))
              .finally(() => setBusy(false));
          }}
        >
          {error || mismatch ? <Alert tone="error">{error ?? 'كلمتا السر غير متطابقتين.'}</Alert> : null}
          <PasswordField
            label="كلمة السر الحالية"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordField
            label="كلمة السر الجديدة"
            autoComplete="new-password"
            hint="8 خانات على الأقل."
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
        </form>
      </Card>
    </div>
  );
}

function Stores({ call, me, onChanged }: { call: Call; me: AgentMe; onChanged: () => void }) {
  const [items, setItems] = useState<AgentStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [picked, setPicked] = useState<AgentStore | null>(null);
  const load = useCallback(() => {
    call<{ items: AgentStore[] }>('/v1/agent/stores')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [call]);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<StateName, number> = { trial: 0, active: 0, late: 0, stopped: 0, none: 0 };
    for (const s of items ?? []) c[stateOf(s)]++;
    return c;
  }, [items]);

  if (error && !items) return <Alert tone="error">{error}</Alert>;
  if (!items) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex flex-col gap-4">
      {done ? <Alert tone="success">{done}</Alert> : null}
      {items.length > 0 ? (
        <p className="text-sm text-ink-muted">
          {items.length} متجر · {counts.active} مشترك · {counts.trial} في التجربة ·{' '}
          {counts.late + counts.stopped} يحتاج تفعيلاً
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="لا متاجر بعد."
          description="حين يسجّل صاحب محل ويكتب كودك، يظهر متجره هنا."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <li key={s.tenantId}>
              <StoreCard store={s} onActivate={() => setPicked(s)} />
            </li>
          ))}
        </ul>
      )}
      {picked ? (
        <ActivateDialog
          call={call}
          me={me}
          store={picked}
          onClose={() => setPicked(null)}
          onDone={(result, plan) => {
            setPicked(null);
            setDone(
              `${result.replay ? 'سبق تفعيله بهذا الطلب. ' : ''}فُعّل ${picked.name} على ${plan} حتى ${dateText(result.periodEnd)}.`,
            );
            load();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function StoreCard({ store, onActivate }: { store: AgentStore; onActivate: () => void }) {
  const state = stateOf(store);
  const trialDays = state === 'trial' ? daysUntil(store.trialEndsAt) : null;
  const trialRunning = trialDays !== null && trialDays > 0;
  const end = state === 'trial' ? store.trialEndsAt : store.currentPeriodEnd;
  const left = daysUntil(end);
  const wa = whatsappLink(store.ownerPhone);
  const blocked = store.tenantStatus === 'suspended';
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold text-ink">{store.name}</span>
          {store.ownerPhone ? (
            <bdi dir="ltr" className="num text-sm text-ink-subtle">
              {store.ownerPhone}
            </bdi>
          ) : null}
        </div>
        <Badge tone={STATE[state].tone}>{STATE[state].text}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col">
          <dt className="text-ink-muted">{state === 'trial' ? 'تنتهي التجربة' : 'ينتهي الاشتراك'}</dt>
          <dd className="num font-semibold text-ink">{dateText(end)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-ink-muted">الباقة</dt>
          <dd className="font-semibold text-ink">
            {state === 'trial' || !store.planName
              ? '—'
              : `${store.planName}${store.billingCycle ? ` · ${CYCLE_TEXT[store.billingCycle]}` : ''}`}
          </dd>
        </div>
      </dl>
      {left !== null && left <= 7 && state !== 'stopped' ? (
        <p className="text-sm font-semibold text-warning">{left > 0 ? `باقٍ ${left} يوم` : 'انتهت المدة'}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="md"
          disabled={trialRunning || blocked}
          onClick={onActivate}
          icon={<CashIcon size={16} />}
        >
          {state === 'active' ? 'جدّد الاشتراك' : 'فعّل الاشتراك'}
        </Button>
        {wa ? (
          <a
            className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-sm font-semibold text-brand hover:bg-surface-muted"
            href={wa}
            target="_blank"
            rel="noreferrer"
          >
            <SendIcon size={16} />
            واتساب
          </a>
        ) : null}
        {internationalDigits(store.ownerPhone) ? (
          <a
            className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-sm font-semibold text-brand hover:bg-surface-muted"
            href={`tel:+${internationalDigits(store.ownerPhone)}`}
          >
            <PhoneIcon size={16} />
            اتصل
          </a>
        ) : null}
      </div>
      {trialRunning ? (
        <p className="text-xs text-ink-subtle">التفعيل بعد انتهاء التجربة المجانية (باقٍ {trialDays} يوم).</p>
      ) : blocked ? (
        <p className="text-xs text-ink-subtle">هذا المتجر موقوف من الإدارة. تواصل معها.</p>
      ) : null}
    </Card>
  );
}

function ActivateDialog({
  call,
  me,
  store,
  onClose,
  onDone,
}: {
  call: Call;
  me: AgentMe;
  store: AgentStore;
  onClose: () => void;
  onDone: (result: AgentActivation, planName: string) => void;
}) {
  const [planCode, setPlanCode] = useState(
    me.plans.find((p) => p.code === store.planCode)?.code ?? me.plans[0]?.code ?? '',
  );
  const [cycle, setCycle] = useState<BillingCycle>(store.billingCycle ?? 'monthly');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: a second tap, or a retry after a dropped connection, is answered, never charged twice
  const key = useRef(requestKey());
  const plan: AgentPlanPrice | undefined = me.plans.find((p) => p.code === planCode);
  const price = plan?.[cycle] ?? null;
  const short = price !== null && price.wholesaleMinor > me.balanceMinor;
  const choose =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      key.current = requestKey();
    };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={`تفعيل ${store.name}`}
      description="يُخصم المبلغ من رصيدك فوراً، ويعمل الاشتراك لمدة كاملة من تاريخ انتهاء الحالي أو من اليوم."
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button
            loading={busy}
            disabled={!price || short}
            onClick={() => {
              setBusy(true);
              setError(null);
              call<AgentActivation>(`/v1/agent/stores/${store.tenantId}/activate`, {
                method: 'POST',
                body: { planCode, billingCycle: cycle, requestKey: key.current },
              })
                .then((r) => onDone(r, plan?.name ?? ''))
                .catch((e: unknown) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            ادفع وفعّل
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {me.plans.length === 0 ? <Alert tone="warning">لا باقات مفتوحة للتفعيل الآن.</Alert> : null}
        <Select label="الباقة" value={planCode} onChange={(e) => choose(setPlanCode)(e.target.value)}>
          {me.plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
        <SegmentedControl
          label="المدة"
          value={cycle}
          onValueChange={choose(setCycle)}
          options={[
            { value: 'monthly', label: 'شهري', disabled: !plan?.monthly },
            { value: 'yearly', label: 'سنوي', disabled: !plan?.yearly },
          ]}
        />
        {price ? (
          <dl className="grid grid-cols-2 gap-3 rounded-card bg-surface-muted p-4 text-sm">
            <dt className="text-ink-muted">سعر القائمة</dt>
            <dd className="text-end text-ink-muted" style={{ textDecoration: 'line-through' }}>
              <Money minor={price.listMinor} currency="USD" />
            </dd>
            <dt className="font-semibold text-ink">سعرك (جملة)</dt>
            <dd className="text-end font-bold text-ink">
              <Money minor={price.wholesaleMinor} currency="USD" />
            </dd>
            <dt className="text-ink-muted">رصيدك بعد التفعيل</dt>
            <dd className="text-end">
              <Money minor={me.balanceMinor - price.wholesaleMinor} currency="USD" negativeTone />
            </dd>
          </dl>
        ) : null}
        {short ? (
          <Alert tone="warning">رصيدك لا يكفي. اشحن رصيدك عند إدارة سيرفا ثم أعد المحاولة.</Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

const LEDGER_KIND: Record<AgentLedgerRow['kind'], string> = {
  topup: 'شحن رصيد',
  adjust: 'تعديل من الإدارة',
  activation: 'تفعيل متجر',
};

function Ledger({ call, balance }: { call: Call; balance: number }) {
  const [items, setItems] = useState<AgentLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<{ items: AgentLedgerRow[] }>('/v1/agent/ledger')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
    // The balance changes after each activation: read the rows again then
  }, [call, balance]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListIcon}
        title="لا حركات بعد."
        description="شحن رصيدك وتفعيلاتك تظهر هنا بالتاريخ."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id}>
          <Card className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-ink">
                {LEDGER_KIND[r.kind]}
                {r.storeName ? ` · ${r.storeName}` : ''}
              </span>
              <span className="num text-xs text-ink-subtle">
                {dateText(r.createdAt)}
                {r.billingCycle ? ` · ${CYCLE_TEXT[r.billingCycle]}` : ''}
                {r.note ? ` · ${r.note}` : ''}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <Money
                minor={r.amountMinor}
                currency="USD"
                className={r.amountMinor > 0 ? 'font-bold text-success' : 'font-bold text-ink'}
              />
              <span className="text-xs text-ink-subtle">
                الرصيد <Money minor={r.balanceAfterMinor} currency="USD" />
              </span>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
