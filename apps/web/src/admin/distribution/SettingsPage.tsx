import { useEffect, useState } from 'react';
import {
  COMMISSION_BASES,
  COMMISSION_RETURNS_EFFECTS,
  DISTRIBUTION_DEFAULTS,
  getCurrency,
  type CommissionPlanRow,
  type DistributionSettings,
  type NoSaleReasonRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  PageHeader,
  EditIcon,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  TextField,
  TruckIcon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import {
  createPlan,
  createReason,
  getSettings,
  listPlans,
  listReasons,
  saveSettings,
  updatePlan,
  updateReason,
} from './api';
import { FormFooter, saveFailure, useLoad, wholeNumber } from './parts';

const SWITCHES: { key: keyof DistributionSettings; label: string; description: string }[] = [
  {
    key: 'requireCustomerApproval',
    label: 'زبون المندوب الجديد يحتاج موافقتك',
    description: 'حتى توافق عليه يبيعه المندوب نقداً فقط، لا بالآجل.',
  },
  {
    key: 'offRouteNeedsReason',
    label: 'زيارة زبون خارج الخط تحتاج سبباً',
    description: 'يكتب المندوب لماذا زار زبوناً ليس على خط اليوم.',
  },
  {
    key: 'gps',
    label: 'سجّل موقع الزيارة',
    description: 'يسجّل الجوال مكان كل زيارة، بموافقة المندوب المذكورة في نص الخصوصية.',
  },
  {
    key: 'keepStockInVanOvernight',
    label: 'تبقى البضاعة في السيارة ليلاً',
    description: 'وإلا ينتهي اليوم بتحويل تفريغ إلى الفرع.',
  },
  {
    key: 'returnsNeedApproval',
    label: 'مرتجع المندوب ينتظر موافقتك',
    description: 'لا يُعتمد المرتجع الذي يأخذه من الزبون حتى تراجعه.',
  },
];

/** The rules of the store's distribution */
function RulesCard() {
  const [loaded, setLoaded] = useState<DistributionSettings | null>(null);
  const [draft, setDraft] = useState<DistributionSettings>(DISTRIBUTION_DEFAULTS);
  const [days, setDays] = useState(String(DISTRIBUTION_DEFAULTS.orderHoldDays));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setLoaded(s);
        setDraft(s);
        setDays(String(s.orderHoldDays));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function save() {
    const hold = wholeNumber(days, 1, 90);
    if (hold === null) {
      setFields({ orderHoldDays: 'اكتب عدد أيام من 1 إلى 90' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    setSaved(false);
    try {
      const next = await saveSettings({ ...draft, orderHoldDays: hold });
      setLoaded(next);
      setDraft(next);
      setSaved(true);
    } catch (e) {
      const failed = saveFailure(e);
      setFields(failed.fields);
      setError(failed.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="قواعد التوزيع" description="تسري على كل المندوبين." />
      {!loaded && !error ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-5">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {saved ? <Alert tone="success">حُفظت القواعد.</Alert> : null}
          <div className="flex flex-col divide-y divide-line rounded-control border border-line px-4">
            {SWITCHES.map((s) => (
              <Switch
                key={s.key}
                label={s.label}
                description={s.description}
                checked={draft[s.key] as boolean}
                onCheckedChange={(on) => setDraft({ ...draft, [s.key]: on })}
                className="py-3"
              />
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="أيام حجز البضاعة للطلبية"
              hint="بعدها تنتهي الطلبية وتتحرر بضاعتها"
              inputMode="numeric"
              dir="ltr"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              error={fields.orderHoldDays}
            />
            <SegmentedControl<DistributionSettings['invoiceOrdersAt']>
              label="تُفوتَر الطلبية عند"
              value={draft.invoiceOrdersAt}
              onValueChange={(v) => setDraft({ ...draft, invoiceOrdersAt: v })}
              options={[
                { value: 'delivery', label: 'التسليم' },
                { value: 'order', label: 'أخذ الطلبية' },
              ]}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving}>
              احفظ القواعد
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReasonDialog({
  reason,
  onSaved,
  onCancel,
}: {
  reason: NoSaleReasonRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(reason?.name ?? '');
  const [active, setActive] = useState(reason?.isActive ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      if (reason) await updateReason(reason.id, { name, isActive: active, version: reason.version });
      else await createReason({ name });
      onSaved();
    } catch (e) {
      const failed = saveFailure(e);
      setFields(failed.fields);
      setError(failed.message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={reason ? 'تعديل السبب' : 'سبب جديد'}
      description="يختاره المندوب حين يزور زبوناً ولا يبيعه."
    >
      <form
        aria-label={reason ? 'تعديل السبب' : 'سبب جديد'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="السبب"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        {reason ? <Switch label="يظهر للمندوب" checked={active} onCheckedChange={setActive} /> : null}
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «أسباب عدم البيع» */
function ReasonsCard() {
  const { data, error, reload } = useLoad(listReasons);
  const [editing, setEditing] = useState<NoSaleReasonRow | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="أسباب عدم البيع"
        description="تظهر للمندوب حين تنتهي الزيارة بلا بيع، وتجمعها التقارير."
        action={
          <Button variant="secondary" icon={<AddIcon />} onClick={() => setEditing('new')}>
            سبب جديد
          </Button>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!data && !error ? <Skeleton className="h-24 w-full" /> : null}
      <ul className="flex flex-col divide-y divide-line">
        {(data ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <span className={r.isActive ? 'flex-1 font-semibold' : 'flex-1 text-ink-muted'}>{r.name}</span>
            {r.isActive ? null : <Badge>موقوف</Badge>}
            <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(r)}>
              عدّل
            </Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <ReasonDialog
          reason={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </Card>
  );
}

const BASIS_LABEL: Record<(typeof COMMISSION_BASES)[number], string> = {
  sales: 'من المبيعات',
  collections: 'من التحصيل',
};
const RETURNS_LABEL: Record<(typeof COMMISSION_RETURNS_EFFECTS)[number], string> = {
  deduct: 'يُخصم المرتجع من العمولة',
  ignore: 'المرتجع لا يؤثر',
};

function PlanDialog({
  plan,
  onSaved,
  onCancel,
}: {
  plan: CommissionPlanRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const factor = 10 ** getCurrency(me.settings.baseCurrency).decimals;
  const [name, setName] = useState(plan?.name ?? '');
  const [basis, setBasis] = useState(plan?.basis ?? 'sales');
  const [mode, setMode] = useState(plan?.mode ?? 'flat');
  const [rate, setRate] = useState(typeof plan?.rateBp === 'number' ? String(plan.rateBp / 100) : '');
  const [tiers, setTiers] = useState(
    (plan?.tiers ?? [{ fromMinor: 0, rateBp: 100 }]).map((t) => ({
      from: String(t.fromMinor / factor),
      rate: String(t.rateBp / 100),
    })),
  );
  const [returnsEffect, setReturnsEffect] = useState(plan?.returnsEffect ?? 'deduct');
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bp = (text: string) => {
    const n = Number(text.replace('٫', '.'));
    return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
  };

  async function save() {
    const found: Record<string, string> = {};
    const flatBp = mode === 'flat' ? bp(rate) : null;
    if (mode === 'flat' && flatBp === null) found.rateBp = 'اكتب نسبة من 0 إلى 100';
    const parsedTiers = tiers.map((t) => ({
      fromMinor: Math.round(Number(t.from.replace(/,/g, '') || '0') * factor),
      rateBp: bp(t.rate),
    }));
    if (
      mode === 'tiered' &&
      parsedTiers.some((t) => t.rateBp === null || !Number.isFinite(t.fromMinor) || t.fromMinor < 0)
    )
      found.tiers = 'راجع الشرائح: مبلغ ونسبة من 0 إلى 100 لكل شريحة';
    if (Object.keys(found).length > 0) {
      setFields(found);
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const input = {
      name,
      basis,
      mode,
      rateBp: flatBp,
      tiers:
        mode === 'tiered'
          ? parsedTiers.map((t) => ({ fromMinor: t.fromMinor, rateBp: t.rateBp ?? 0 }))
          : null,
      returnsEffect,
      isActive: active,
    };
    try {
      if (plan) await updatePlan(plan.id, { ...input, version: plan.version });
      else await createPlan(input);
      onSaved();
    } catch (e) {
      const failed = saveFailure(e);
      setFields(failed.fields);
      setError(failed.message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={plan ? `تعديل ${plan.name}` : 'خطة عمولة جديدة'}
      description="العمولة تظهر في التقارير فقط، ولا تُسجَّل قيداً مالياً."
    >
      <form
        aria-label={plan ? 'تعديل الخطة' : 'خطة عمولة جديدة'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="اسم الخطة"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="تُحسب" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
            {COMMISSION_BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_LABEL[b]}
              </option>
            ))}
          </Select>
          <Select
            label="المرتجع"
            value={returnsEffect}
            onChange={(e) => setReturnsEffect(e.target.value as typeof returnsEffect)}
          >
            {COMMISSION_RETURNS_EFFECTS.map((b) => (
              <option key={b} value={b}>
                {RETURNS_LABEL[b]}
              </option>
            ))}
          </Select>
        </div>
        <SegmentedControl<'flat' | 'tiered'>
          label="طريقة الحساب"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'flat', label: 'نسبة ثابتة' },
            { value: 'tiered', label: 'شرائح' },
          ]}
        />
        {mode === 'flat' ? (
          <TextField
            label="النسبة %"
            inputMode="decimal"
            dir="ltr"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            error={fields.rateBp}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <TextField
                  label={`الشريحة ${i + 1}: من مبلغ`}
                  className="min-w-0 flex-1 basis-40"
                  inputMode="numeric"
                  dir="ltr"
                  value={t.from}
                  onChange={(e) =>
                    setTiers(tiers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                  }
                />
                <TextField
                  label="النسبة %"
                  className="min-w-0 flex-1 basis-40"
                  inputMode="decimal"
                  dir="ltr"
                  value={t.rate}
                  onChange={(e) =>
                    setTiers(tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={tiers.length === 1}
                  onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                >
                  احذف
                </Button>
              </div>
            ))}
            {fields.tiers ? <p className="text-sm text-danger-ink">{fields.tiers}</p> : null}
            {tiers.length < 10 ? (
              <Button
                variant="secondary"
                icon={<AddIcon />}
                onClick={() => setTiers([...tiers, { from: '', rate: '' }])}
              >
                شريحة
              </Button>
            ) : null}
          </div>
        )}
        {plan ? <Switch label="فعّالة" checked={active} onCheckedChange={setActive} /> : null}
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «خطط العمولة»: report-only for now */
function PlansCard() {
  const { data, error, reload } = useLoad(listPlans);
  const [editing, setEditing] = useState<CommissionPlanRow | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="خطط العمولة"
        description="تُربط بالمندوب من صفحته، وتظهر عمولته في التقارير."
        action={
          <Button variant="secondary" icon={<AddIcon />} onClick={() => setEditing('new')}>
            خطة جديدة
          </Button>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!data && !error ? <Skeleton className="h-16 w-full" /> : null}
      {data && data.length === 0 ? <p className="py-3 text-sm text-ink-muted">لا خطط بعد.</p> : null}
      <ul className="flex flex-col divide-y divide-line">
        {(data ?? []).map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className={p.isActive ? 'font-semibold' : 'text-ink-muted'}>{p.name}</span>
              <span className="text-xs text-ink-muted">
                {BASIS_LABEL[p.basis]} ·{' '}
                {p.mode === 'flat' ? `${(p.rateBp ?? 0) / 100}%` : `${p.tiers?.length ?? 0} شرائح`}
              </span>
            </div>
            {p.isActive ? null : <Badge>موقوفة</Badge>}
            <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(p)}>
              عدّل
            </Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <PlanDialog
          plan={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </Card>
  );
}

/** «إعدادات التوزيع»: the rules, the no-sale reasons and the commission plans */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="إعدادات التوزيع" description="قواعد المندوبين وقوائمهم." icon={<TruckIcon />} />
      <RulesCard />
      <div className="grid gap-6 lg:grid-cols-2">
        <ReasonsCard />
        <PlansCard />
      </div>
    </>
  );
}
