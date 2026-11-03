import { useCallback, useEffect, useState } from 'react';
import type {
  PaymentMethodInfo,
  PlanRow,
  PlatformLoginResponse,
  PlatformPayment,
  PlatformSettings,
  PlatformStore,
} from '@serva/core';
import {
  Alert,
  Button,
  cn,
  DataTable,
  Logo,
  Money,
  PasswordField,
  Tabs,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../lib/api';

/**
 * The platform panel (07 › لوحة مدير المنصة), apart from the stores: its own sign-in (email and
 * password of a platform account, eight hours), then the stores and their subscriptions, the
 * payments waiting to be confirmed, the plans and their prices, and how stores pay.
 */

const TOKEN_KEY = 'servaPlatformToken';
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

const STATUS_TEXT: Record<string, string> = {
  trialing: 'تجربة',
  active: 'مشترك',
  past_due: 'متأخر',
  suspended: 'موقوف',
  cancelled: 'ملغى',
};
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');

export function PlatformApp() {
  const [token, setToken] = useState<string | null>(readToken);
  const signOut = () => {
    keepToken(null);
    setToken(null);
  };
  return (
    <div dir="rtl" className="min-h-dvh bg-canvas">
      <title>لوحة المنصة · Serva</title>
      {token ? (
        <Panel token={token} onSignOut={signOut} />
      ) : (
        <Login
          onSignedIn={(t) => {
            keepToken(t);
            setToken(t);
          }}
        />
      )}
    </div>
  );
}

function Login({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 px-4 py-16">
      <Logo />
      <h1 className="text-2xl font-bold text-ink">لوحة المنصة</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          apiFetch<PlatformLoginResponse>('/v1/platform/login', { method: 'POST', body: { email, password } })
            .then((r) => onSignedIn(r.token))
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="البريد الإلكتروني"
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField label="كلمة السر" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy}>
          ادخل
        </Button>
      </form>
    </main>
  );
}

function usePlatform(token: string, onSignOut: () => void) {
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

function Panel({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const call = usePlatform(token, onSignOut);
  const [tab, setTab] = useState('payments');
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center gap-4">
        <Logo />
        <h1 className="flex-1 text-2xl font-bold text-ink">لوحة المنصة</h1>
        <Button variant="ghost" onClick={onSignOut}>
          اخرج
        </Button>
      </div>
      <Tabs
        label="أقسام اللوحة"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'payments', label: 'الدفعات', content: <Payments call={call} /> },
          { value: 'stores', label: 'المتاجر', content: <Stores call={call} /> },
          { value: 'plans', label: 'الباقات والأسعار', content: <Plans call={call} /> },
          { value: 'settings', label: 'طرق الدفع', content: <Settings call={call} /> },
        ]}
      />
    </main>
  );
}

type Call = ReturnType<typeof usePlatform>;

function useList<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, error, reload, setError };
}

function Payments({ call }: { call: Call }) {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'rejected'>('pending');
  const load = useCallback(
    () => call<{ items: PlatformPayment[] }>(`/v1/platform/payments?status=${status}`),
    [call, status],
  );
  const { data, error, reload, setError } = useList(load);
  const act = async (id: string, confirm: boolean) => {
    const reason = confirm ? null : window.prompt('سبب الرفض؟');
    if (!confirm && !reason) return;
    try {
      await call(`/v1/platform/payments/${id}/${confirm ? 'confirm' : 'reject'}`, {
        method: 'POST',
        ...(confirm ? {} : { body: { reason } }),
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const columns: DataColumn<PlatformPayment>[] = [
    { key: 'store', header: 'المتجر', cell: (p) => <span className="font-semibold">{p.storeName}</span> },
    {
      key: 'invoice',
      header: 'الفاتورة',
      cell: (p) => (
        <bdi dir="ltr" className="num">
          {p.invoiceNumber}
        </bdi>
      ),
    },
    {
      key: 'plan',
      header: 'الباقة',
      cell: (p) => `${p.planName} · ${p.billingCycle === 'yearly' ? 'سنوي' : 'شهري'}`,
    },
    {
      key: 'ref',
      header: 'رقم العملية',
      cell: (p) => <bdi dir="ltr" className="num">{`${p.method} · ${p.transactionRef}`}</bdi>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (p) => (
        <span className="flex flex-col items-end">
          <Money minor={p.amountMinor} currency={p.currency} className="font-semibold" />
          <span className="text-xs text-ink-muted">
            المطلوب{' '}
            <Money
              minor={p.currency === 'SYP' ? p.invoiceSypMinor : p.invoiceUsdMinor}
              currency={p.currency}
            />
          </span>
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      cell: (p) =>
        p.status === 'pending' ? (
          <span className="flex gap-2">
            <Button onClick={() => void act(p.id, true)}>أكّد</Button>
            <Button variant="ghost" onClick={() => void act(p.id, false)}>
              ارفض
            </Button>
          </span>
        ) : (
          (p.reason ?? '')
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="الحالة" className="flex gap-2">
        {(['pending', 'confirmed', 'rejected'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              'min-h-11 rounded-control border-2 px-4 font-semibold',
              status === s ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink',
            )}
          >
            {s === 'pending' ? 'بانتظار التأكيد' : s === 'confirmed' ? 'مؤكدة' : 'مرفوضة'}
          </button>
        ))}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="الدفعات"
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(p) => p.id}
        loading={!data && !error}
        empty="لا دفعات هنا."
      />
    </div>
  );
}

function Stores({ call }: { call: Call }) {
  const load = useCallback(() => call<{ items: PlatformStore[] }>('/v1/platform/stores'), [call]);
  const { data, error, reload, setError } = useList(load);
  const extend = async (s: PlatformStore) => {
    const days = Number(window.prompt('كم يوماً تضيف؟', '30'));
    if (!days || days < 1) return;
    const from = Math.max(Date.now(), s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : 0);
    try {
      await call(`/v1/platform/stores/${s.tenantId}/subscription`, {
        method: 'PUT',
        body: {
          planCode: s.planCode ?? 'free',
          status: s.status === 'trialing' ? 'trialing' : 'active',
          currentPeriodEnd: new Date(from + days * 86_400_000).toISOString(),
        },
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const columns: DataColumn<PlatformStore>[] = [
    {
      key: 'name',
      header: 'المتجر',
      cell: (s) => (
        <span className="flex flex-col">
          <span className="font-semibold">{s.name}</span>
          <span className="num text-xs text-ink-muted" dir="ltr">
            {s.ownerPhone ?? ''} · {s.storeCode}
          </span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'الباقة',
      cell: (s) => `${s.planName ?? '—'} · ${STATUS_TEXT[s.status ?? ''] ?? '—'}`,
    },
    { key: 'end', header: 'تنتهي', cell: (s) => <span className="num">{dateText(s.currentPeriodEnd)}</span> },
    { key: 'sale', header: 'آخر بيع', cell: (s) => <span className="num">{s.lastSale ?? '—'}</span> },
    { key: 'pending', header: 'دفعات معلّقة', numeric: true, cell: (s) => s.pendingPayments },
    {
      key: 'act',
      header: '',
      cell: (s) => (
        <Button variant="secondary" onClick={() => void extend(s)}>
          مدّد
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="المتاجر"
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(s) => s.tenantId}
        loading={!data && !error}
        empty="لا متاجر بعد."
      />
    </div>
  );
}

const centsText = (v: number | null) => (v === null ? '' : String(v / 100));
const centsOf = (t: string) => (t.trim() === '' ? null : Math.round(Number(t) * 100) || null);

function Plans({ call }: { call: Call }) {
  const load = useCallback(() => call<{ items: PlanRow[] }>('/v1/platform/plans'), [call]);
  const { data, error, reload, setError } = useList(load);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">حُفظت باقة {saved}.</Alert> : null}
      {(data?.items ?? []).map((plan) => (
        <PlanForm
          key={plan.code}
          plan={plan}
          onSave={async (input) => {
            try {
              await call(`/v1/platform/plans/${plan.code}`, { method: 'PUT', body: input });
              setSaved(input.name);
              reload();
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      ))}
    </div>
  );
}

function PlanForm({
  plan,
  onSave,
}: {
  plan: PlanRow;
  onSave: (input: {
    name: string;
    priceMonthlyMinor: number | null;
    priceYearlyMinor: number | null;
    trialDays: number | null;
    isActive: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(plan.name);
  const [monthly, setMonthly] = useState(centsText(plan.priceMonthlyMinor));
  const [yearly, setYearly] = useState(centsText(plan.priceYearlyMinor));
  const [trial, setTrial] = useState(plan.trialDays === null ? '' : String(plan.trialDays));
  return (
    <form
      aria-label={`باقة ${plan.name}`}
      className="grid gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-5 md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          name,
          priceMonthlyMinor: centsOf(monthly),
          priceYearlyMinor: centsOf(yearly),
          trialDays: trial.trim() === '' ? null : Number(trial),
          isActive: plan.isActive,
        });
      }}
    >
      <TextField label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="شهرياً بالدولار"
        dir="ltr"
        value={monthly}
        onChange={(e) => setMonthly(e.target.value)}
      />
      <TextField
        label="سنوياً بالدولار"
        dir="ltr"
        value={yearly}
        onChange={(e) => setYearly(e.target.value)}
      />
      <TextField label="أيام التجربة" dir="ltr" value={trial} onChange={(e) => setTrial(e.target.value)} />
      <Button type="submit">احفظ</Button>
    </form>
  );
}

function Settings({ call }: { call: Call }) {
  const load = useCallback(() => call<PlatformSettings>('/v1/platform/settings'), [call]);
  const { data, error, setError } = useList(load);
  const [methods, setMethods] = useState<PaymentMethodInfo[] | null>(null);
  const [rate, setRate] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) {
      setMethods(data.paymentMethods);
      setRate(data.sypPerUsd);
    }
  }, [data]);
  if (!methods) return error ? <Alert tone="error">{error}</Alert> : null;
  const edit = (i: number, patch: Partial<PaymentMethodInfo>) =>
    setMethods((all) => all!.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        call('/v1/platform/settings', { method: 'PUT', body: { paymentMethods: methods, sypPerUsd: rate } })
          .then(() => setSaved(true))
          .catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">حُفظت طرق الدفع وسعر الصرف.</Alert> : null}
      <TextField
        label="سعر الدولار للفواتير (ليرة)"
        hint="من نشرة المصرف المركزي، يُحدَّث أسبوعياً"
        dir="ltr"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />
      {methods.map((m, i) => (
        <fieldset
          key={m.key}
          className="grid gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-2"
        >
          <legend className="px-1 font-semibold text-ink">{m.label}</legend>
          <TextField
            label={`رقم حساب ${m.label}`}
            dir="ltr"
            value={m.account}
            onChange={(e) => edit(i, { account: e.target.value })}
          />
          <TextField
            label={`المستفيد في ${m.label}`}
            value={m.beneficiary}
            onChange={(e) => edit(i, { beneficiary: e.target.value })}
          />
          <TextField
            label={`تعليمات ${m.label}`}
            value={m.instructions}
            onChange={(e) => edit(i, { instructions: e.target.value })}
            className="md:col-span-2"
          />
          <label className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              checked={m.enabled}
              onChange={(e) => edit(i, { enabled: e.target.checked })}
            />
            مفعّلة
          </label>
        </fieldset>
      ))}
      <Button type="submit">احفظ</Button>
    </form>
  );
}
