import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentInput,
  AgentLedgerRow,
  AgentStore,
  BillingCycle,
  PlanRow,
  PlatformAgent,
  PlatformAgentPage,
} from '@serva/core';
import { wholesalePrice } from '@serva/core';
import {
  Alert,
  BackIcon,
  Badge,
  Button,
  Card,
  CardHeader,
  CashIcon,
  DataTable,
  Dialog,
  EditIcon,
  EmptyState,
  IconChip,
  ListIcon,
  Money,
  AddIcon,
  SegmentedControl,
  Select,
  Skeleton,
  StatTile,
  StoreIcon,
  TextField,
  UserIcon,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { errorMessage } from '../../lib/api';
import { whatsappLink } from '../../lib/phoneLinks';

/**
 * The owner's agents pages (07 › برنامج الوكلاء): the list of agents with their balances, and one
 * agent's page: his terms, his prepaid balance and its ledger, and his stores, which the owner can
 * move to another agent. Money here is the platform's own, never a store's books.
 */

export type Call = <T>(
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown },
) => Promise<T>;

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');
const dollars = (cents: number | undefined) => (cents === undefined ? '' : String(cents / 100));
const cents = (text: string) => {
  const n = Math.round(Number(text.trim().replace(',', '.')) * 100);
  return Number.isFinite(n) ? n : 0;
};
const CYCLE_TEXT: Record<BillingCycle, string> = { monthly: 'شهري', yearly: 'سنوي' };
const STATUS_TEXT: Record<string, string> = {
  trialing: 'تجربة',
  active: 'مشترك',
  past_due: 'متأخر',
  suspended: 'موقوف',
  cancelled: 'ملغى',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};
const KIND_TEXT: Record<AgentLedgerRow['kind'], string> = {
  topup: 'شحن رصيد',
  adjust: 'خصم من الإدارة',
  activation: 'تفعيل متجر',
};
const newKey = () => `plt-${crypto.randomUUID()}`;

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function PlatformAgents({ call }: { call: Call }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? (
    <AgentPage call={call} id={openId} onBack={() => setOpenId(null)} />
  ) : (
    <AgentList call={call} onOpen={setOpenId} />
  );
}

function AgentList({ call, onOpen }: { call: Call; onOpen: (id: string) => void }) {
  const load = useCallback(() => call<{ items: PlatformAgent[] }>('/v1/platform/agents'), [call]);
  const { data, error, reload } = useLoad(load);
  const [adding, setAdding] = useState(false);
  const items = data?.items;
  const columns: DataColumn<PlatformAgent>[] = [
    {
      key: 'name',
      header: 'الوكيل',
      cell: (a) => (
        <span className="flex items-center gap-3 py-1.5 whitespace-nowrap">
          <IconChip size="sm">
            <UserIcon size={16} />
          </IconChip>
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{a.fullName}</span>
            <span className="text-xs text-ink-subtle">
              <bdi dir="ltr" className="num">
                {a.code}
              </bdi>
              {a.region ? ` · ${a.region}` : ''}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (a) => (
        <Badge tone={a.status === 'active' ? 'success' : 'danger'}>
          {a.status === 'active' ? 'فعّال' : 'موقوف'}
        </Badge>
      ),
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      cell: (a) => <Money minor={a.balanceMinor} currency="USD" className="font-semibold" />,
    },
    {
      key: 'stores',
      header: 'المتاجر',
      cell: (a) => (
        <span className="num whitespace-nowrap">
          {a.stores} · {a.paying} مشترك · {a.trialing} تجربة
        </span>
      ),
    },
    {
      key: 'discount',
      header: 'خصم الجملة',
      numeric: true,
      cell: (a) => <span className="num">{a.discountBp / 100}%</span>,
    },
    {
      key: 'open',
      header: '',
      className: 'w-px',
      cell: (a) => (
        <Button variant="secondary" onClick={() => onOpen(a.id)}>
          افتح
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      {items ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="الوكلاء" value={items.length} icon={<UserIcon size={16} />} />
          <StatTile
            label="متاجرهم"
            value={items.reduce((n, a) => n + a.stores, 0)}
            icon={<StoreIcon size={16} />}
          />
          <StatTile
            label="مشتركة"
            value={items.reduce((n, a) => n + a.paying, 0)}
            icon={<CashIcon size={16} />}
            iconTone="success"
          />
          <StatTile
            label="مجموع الأرصدة"
            value={<Money minor={items.reduce((n, a) => n + a.balanceMinor, 0)} currency="USD" />}
            icon={<CashIcon size={16} />}
          />
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button icon={<AddIcon size={16} />} onClick={() => setAdding(true)}>
          أضف وكيلاً
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="الوكلاء"
        columns={columns}
        rows={items ?? []}
        rowKey={(a) => a.id}
        loading={!data && !error}
        empty={
          <EmptyState
            icon={UserIcon}
            title="لا وكلاء بعد."
            description="أضف وكيلاً بكوده وبريده وسعر الجملة، ثم اشحن رصيده ليفعّل المتاجر."
          />
        }
      />
      {adding ? (
        <AgentForm
          call={call}
          agent={null}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            reload();
            if (id) onOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function AgentPage({ call, id, onBack }: { call: Call; id: string; onBack: () => void }) {
  const load = useCallback(() => call<PlatformAgentPage>(`/v1/platform/agents/${id}`), [call, id]);
  const { data, error, reload } = useLoad(load);
  const [editing, setEditing] = useState(false);
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" icon={<BackIcon size={16} />} onClick={onBack} className="self-start">
          كل الوكلاء
        </Button>
        {error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-40 w-full" />}
      </div>
    );
  }
  const { agent, stores, ledger } = data;
  const wa = whatsappLink(agent.phone);
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" icon={<BackIcon size={16} />} onClick={onBack} className="self-start">
        كل الوكلاء
      </Button>
      <Card className="flex flex-col gap-4">
        <CardHeader
          icon={<UserIcon />}
          title={agent.fullName}
          description={
            <span>
              كوده{' '}
              <bdi dir="ltr" className="num font-semibold">
                {agent.code}
              </bdi>
              {agent.region ? ` · ${agent.region}` : ''}
            </span>
          }
          action={
            <>
              <Badge tone={agent.status === 'active' ? 'success' : 'danger'}>
                {agent.status === 'active' ? 'فعّال' : 'موقوف'}
              </Badge>
              <Button variant="secondary" icon={<EditIcon size={16} />} onClick={() => setEditing(true)}>
                عدّل
              </Button>
            </>
          }
        />
        <dl className="grid gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="الجوال">
            {agent.phone ? (
              <span className="flex items-center gap-2">
                <bdi dir="ltr" className="num">
                  {agent.phone}
                </bdi>
                {wa ? (
                  <a className="text-brand" href={wa} target="_blank" rel="noreferrer">
                    واتساب
                  </a>
                ) : null}
              </span>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="بريد الدخول">
            {agent.email ? <bdi dir="ltr">{agent.email}</bdi> : 'لم يُحدَّد: لا يستطيع الدخول'}
          </Fact>
          <Fact label="خصم الجملة">
            <span className="num">{agent.discountBp / 100}%</span> من سعر القائمة
          </Fact>
          <Fact label="أسعار خاصة">
            {Object.keys(agent.priceOverrides).length > 0
              ? Object.keys(agent.priceOverrides).join('، ')
              : 'لا يوجد'}
          </Fact>
        </dl>
        {agent.note ? <p className="text-sm text-ink-muted">{agent.note}</p> : null}
      </Card>
      <BalanceCard call={call} agent={agent} onChanged={reload} />
      <StoresCard call={call} agent={agent} stores={stores} onChanged={reload} />
      <LedgerCard ledger={ledger} />
      {editing ? (
        <AgentForm
          call={call}
          agent={agent}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

function BalanceCard({
  call,
  agent,
  onChanged,
}: {
  call: Call;
  agent: PlatformAgent;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'topup' | 'deduct'>('topup');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per intended operation: tapping twice, or retrying after a lost answer, never counts twice
  const key = useRef(newKey());
  const value = cents(amount);
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader
        icon={<CashIcon />}
        title="الرصيد المدفوع مسبقاً"
        description="يشحنه الوكيل بحوالة إليك، وأنت تضيفه هنا بعد أن تتأكد من وصولها."
        action={<Money minor={agent.balanceMinor} currency="USD" className="text-xl font-bold" />}
      />
      <form
        className="grid gap-4 border-t border-line pt-4 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (value <= 0 || busy) return;
          setBusy(true);
          setError(null);
          setDone(null);
          call<{ balanceMinor: number }>(`/v1/platform/agents/${agent.id}/balance`, {
            method: 'POST',
            body: { amountMinor: mode === 'topup' ? value : -value, note, requestKey: key.current },
          })
            .then(() => {
              key.current = newKey();
              setAmount('');
              setNote('');
              setDone(mode === 'topup' ? 'أُضيف المبلغ إلى الرصيد.' : 'خُصم المبلغ من الرصيد.');
              onChanged();
            })
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        <SegmentedControl
          label="العملية"
          value={mode}
          onValueChange={(v) => {
            setMode(v);
            key.current = newKey();
          }}
          options={[
            { value: 'topup', label: 'شحن' },
            { value: 'deduct', label: 'خصم' },
          ]}
        />
        <TextField
          label="المبلغ بالدولار"
          dir="ltr"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            key.current = newKey();
          }}
        />
        <TextField
          label="ملاحظة (رقم الحوالة مثلاً)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" loading={busy} disabled={value <= 0}>
          {mode === 'topup' ? 'أضف إلى الرصيد' : 'اخصم'}
        </Button>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}
    </Card>
  );
}

function StoresCard({
  call,
  agent,
  stores,
  onChanged,
}: {
  call: Call;
  agent: PlatformAgent;
  stores: AgentStore[];
  onChanged: () => void;
}) {
  const { data: all } = useLoad(
    useCallback(() => call<{ items: PlatformAgent[] }>('/v1/platform/agents'), [call]),
  );
  const [error, setError] = useState<string | null>(null);
  const move = async (store: AgentStore, agentId: string) => {
    const target = agentId === '' ? null : agentId;
    const to = all?.items.find((a) => a.id === agentId)?.fullName ?? 'المنصة مباشرة (بلا وكيل)';
    if (!window.confirm(`تنقل «${store.name}» إلى ${to}؟`)) return;
    try {
      await call(`/v1/platform/stores/${store.tenantId}/agent`, { method: 'PUT', body: { agentId: target } });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const columns: DataColumn<AgentStore>[] = [
    {
      key: 'name',
      header: 'المتجر',
      cell: (s) => (
        <span className="flex flex-col py-1.5 whitespace-nowrap">
          <span className="font-semibold">{s.name}</span>
          <bdi dir="ltr" className="num text-xs text-ink-subtle">
            {s.ownerPhone ?? ''}
          </bdi>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الاشتراك',
      cell: (s) =>
        s.status ? (
          <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_TEXT[s.status] ?? s.status}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'plan',
      header: 'الباقة',
      cell: (s) => (
        <span className="whitespace-nowrap">
          {s.status === 'trialing' ? '—' : (s.planName ?? '—')}
          {s.billingCycle && s.status !== 'trialing' ? ` · ${CYCLE_TEXT[s.billingCycle]}` : ''}
        </span>
      ),
    },
    {
      key: 'end',
      header: 'التجديد',
      cell: (s) => (
        <span className="num whitespace-nowrap">
          {dateText(s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd)}
        </span>
      ),
    },
    {
      key: 'move',
      header: 'انقل إلى',
      cell: (s) => (
        <Select
          label={`انقل ${s.name}`}
          hideLabel
          value=""
          onChange={(e) => void move(s, e.target.value === '__none' ? '' : e.target.value)}
        >
          <option value="" disabled>
            اختر…
          </option>
          {(all?.items ?? [])
            .filter((a) => a.id !== agent.id && a.status === 'active')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          <option value="__none">المنصة مباشرة (بلا وكيل)</option>
        </Select>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">متاجره</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="متاجر الوكيل"
        columns={columns}
        rows={stores}
        rowKey={(s) => s.tenantId}
        empty={
          <EmptyState
            icon={StoreIcon}
            title="لا متاجر له."
            description="المتجر الذي يسجّل بكود هذا الوكيل يظهر هنا، أو تنقل إليه متجراً من صفحة وكيل آخر."
          />
        }
      />
    </div>
  );
}

function LedgerCard({ ledger }: { ledger: AgentLedgerRow[] }) {
  const columns: DataColumn<AgentLedgerRow>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      cell: (r) => <span className="num whitespace-nowrap">{dateText(r.createdAt)}</span>,
    },
    {
      key: 'what',
      header: 'الحركة',
      cell: (r) => (
        <span className="flex flex-col py-1.5">
          <span className="font-semibold">
            {KIND_TEXT[r.kind]}
            {r.storeName ? ` · ${r.storeName}` : ''}
          </span>
          {r.note || r.planCode ? (
            <span className="text-xs text-ink-subtle">
              {[r.planCode, r.billingCycle ? CYCLE_TEXT[r.billingCycle] : null, r.note]
                .filter(Boolean)
                .join(' · ')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (r) => (
        <Money
          minor={r.amountMinor}
          currency="USD"
          className={r.amountMinor > 0 ? 'font-semibold text-success' : 'font-semibold'}
        />
      ),
    },
    {
      key: 'after',
      header: 'الرصيد بعدها',
      numeric: true,
      cell: (r) => <Money minor={r.balanceAfterMinor} currency="USD" />,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">سجل الرصيد</h2>
      <DataTable
        caption="سجل الرصيد"
        columns={columns}
        rows={ledger}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={ListIcon}
            title="لا حركات بعد."
            description="الشحن والخصم والتفعيلات تظهر هنا بالتاريخ."
          />
        }
      />
    </div>
  );
}

/** Adding an agent or editing one: his terms, his sign-in and what each plan costs him. */
function AgentForm({
  call,
  agent,
  onClose,
  onSaved,
}: {
  call: Call;
  agent: PlatformAgent | null;
  onClose: () => void;
  onSaved: (id: string | null) => void;
}) {
  const { data: plans } = useLoad(
    useCallback(() => call<{ items: PlanRow[] }>('/v1/platform/plans'), [call]),
  );
  const [f, setF] = useState({
    fullName: agent?.fullName ?? '',
    code: agent?.code ?? '',
    phone: agent?.phone ?? '',
    email: agent?.email ?? '',
    region: agent?.region ?? '',
    status: agent?.status ?? 'active',
    discount: String((agent?.discountBp ?? 2000) / 100),
    note: agent?.note ?? '',
    password: '',
  });
  const [prices, setPrices] = useState<Record<string, { monthly: string; yearly: string }>>(() =>
    Object.fromEntries(
      Object.entries(agent?.priceOverrides ?? {}).map(([code, p]) => [
        code,
        { monthly: dollars(p.monthly), yearly: dollars(p.yearly) },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const discountBp = Math.round(Number(f.discount || '0') * 100);
  const paid = (plans?.items ?? []).filter((p) => !p.isFree && p.isActive);

  const save = () => {
    const priceOverrides: AgentInput['priceOverrides'] = {};
    for (const [code, p] of Object.entries(prices)) {
      const monthly = cents(p.monthly);
      const yearly = cents(p.yearly);
      if (monthly > 0 || yearly > 0) {
        priceOverrides[code] = { ...(monthly > 0 ? { monthly } : {}), ...(yearly > 0 ? { yearly } : {}) };
      }
    }
    setBusy(true);
    setError(null);
    setFields({});
    const body: AgentInput = {
      code: f.code,
      fullName: f.fullName,
      phone: f.phone,
      email: f.email,
      region: f.region,
      status: f.status,
      discountBp,
      priceOverrides,
      note: f.note,
      password: f.password,
    };
    const request = agent
      ? call(`/v1/platform/agents/${agent.id}`, { method: 'PUT', body }).then(() => null)
      : call<{ id: string }>('/v1/platform/agents', { method: 'POST', body }).then((r) => r.id);
    request
      .then(onSaved)
      .catch((e: unknown) => {
        setError(errorMessage(e));
        setFields((e as { fields?: Record<string, string> }).fields ?? {});
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={agent ? `تعديل ${agent.fullName}` : 'وكيل جديد'}
      description="الكود يكتبه صاحب المحل عند التسجيل. بريد الدخول وكلمة السر يفتحان له لوحته."
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button loading={busy} onClick={save}>
            احفظ
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 overflow-y-auto p-1" style={{ maxHeight: '65dvh' }}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="الاسم" value={f.fullName} onChange={set('fullName')} error={fields.fullName} />
          <TextField label="الكود" dir="ltr" value={f.code} onChange={set('code')} error={fields.code} />
          <TextField label="الجوال" dir="ltr" value={f.phone} onChange={set('phone')} error={fields.phone} />
          <TextField label="المنطقة" value={f.region} onChange={set('region')} />
          <TextField
            label="البريد (للدخول)"
            type="email"
            dir="ltr"
            value={f.email}
            onChange={set('email')}
            error={fields.email}
          />
          <TextField
            label={agent?.hasLogin ? 'كلمة سر جديدة (اتركها فارغة لإبقاء القديمة)' : 'كلمة سر مؤقتة'}
            dir="ltr"
            autoComplete="new-password"
            hint="8 خانات على الأقل. يغيّرها الوكيل عند أول دخول."
            value={f.password}
            onChange={set('password')}
            error={fields.password}
          />
          <Select label="الحالة" value={f.status} onChange={set('status')}>
            <option value="active">فعّال</option>
            <option value="suspended">موقوف (لا يدخل ولا يُنسب إليه متجر جديد)</option>
          </Select>
          <TextField
            label="خصم الجملة %"
            dir="ltr"
            inputMode="decimal"
            hint="من سعر القائمة لكل الباقات. سعر خاص أدناه يغلبه."
            value={f.discount}
            onChange={set('discount')}
            error={fields.discountBp}
          />
        </div>
        {paid.length > 0 ? (
          <fieldset className="flex flex-col gap-3 rounded-card border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink">أسعار خاصة بالدولار (اختياري)</legend>
            {paid.map((p) => {
              const cur = prices[p.code] ?? { monthly: '', yearly: '' };
              const setPrice = (k: 'monthly' | 'yearly') => (e: { target: { value: string } }) =>
                setPrices((x) => ({ ...x, [p.code]: { ...cur, [k]: e.target.value } }));
              const byDiscount = (list: number | null) =>
                list ? (wholesalePrice(list, discountBp, undefined) / 100).toString() + '$ بالخصم' : '—';
              return (
                <div key={p.code} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                  <span className="pb-3 font-semibold">{p.name}</span>
                  <TextField
                    label="شهري"
                    dir="ltr"
                    inputMode="decimal"
                    hint={byDiscount(p.priceMonthlyMinor)}
                    value={cur.monthly}
                    onChange={setPrice('monthly')}
                  />
                  <TextField
                    label="سنوي"
                    dir="ltr"
                    inputMode="decimal"
                    hint={byDiscount(p.priceYearlyMinor)}
                    value={cur.yearly}
                    onChange={setPrice('yearly')}
                  />
                </div>
              );
            })}
          </fieldset>
        ) : null}
        <TextField label="ملاحظة" value={f.note} onChange={set('note')} />
      </div>
    </Dialog>
  );
}
