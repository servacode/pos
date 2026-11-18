import { useEffect, useState } from 'react';
import {
  countNoun,
  getCurrency,
  REP_MODE_LABELS,
  REP_MODES,
  type CommissionPlanRow,
  type RepCandidate,
  type RepMode,
  type RepRow,
  type VanRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EditIcon,
  EmptyState,
  Money,
  PageHeader,
  Select,
  TextField,
  UserIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import {
  createRep,
  listPlans,
  listRepCandidates,
  listRepDebts,
  listReps,
  listVans,
  setRepActive,
  updateRep,
} from './api';
import { FormFooter, ROUTE_NOUN, saveFailure, useLoad } from './parts';
import { RepDebtDialog } from './RepDebtDialog';

/** «5» → 500 basis points; '' → null (his role's limit); NaN when it is not 0 to 100 */
function percentToBp(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.replace('٫', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : Number.NaN;
}

function RepDialog({
  rep,
  vans,
  plans,
  onSaved,
  onCancel,
}: {
  rep: RepRow | null;
  vans: readonly VanRow[];
  plans: readonly CommissionPlanRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const factor = 10 ** getCurrency(base).decimals;
  const [candidates, setCandidates] = useState<RepCandidate[]>([]);
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState(rep?.branchId ?? me.branches[0]?.id ?? '');
  const [vanId, setVanId] = useState(rep?.vanBranchId ?? '');
  const [mode, setMode] = useState<RepMode>(rep?.mode ?? 'van');
  const [discount, setDiscount] = useState(
    typeof rep?.maxDiscountBp === 'number' ? String(rep.maxDiscountBp / 100) : '',
  );
  const [credit, setCredit] = useState(
    typeof rep?.dailyCreditLimitMinor === 'number' ? String(rep.dailyCreditLimitMinor / factor) : '',
  );
  const [planId, setPlanId] = useState(rep?.commissionPlanId ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (rep) return;
    listRepCandidates()
      .then((list) => {
        setCandidates(list);
        setUserId(list[0]?.userId ?? '');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [rep]);

  async function save() {
    const bp = percentToBp(discount);
    const creditMinor = credit.trim() ? Math.round(Number(credit.replace(/,/g, '')) * factor) : null;
    const found: Record<string, string> = {};
    if (Number.isNaN(bp)) found.maxDiscountBp = 'اكتب نسبة من 0 إلى 100، أو اتركها فارغة';
    if (creditMinor !== null && (!Number.isFinite(creditMinor) || creditMinor < 0))
      found.dailyCreditLimitMinor = 'اكتب مبلغاً صحيحاً، أو اتركه فارغاً';
    if (!rep && !userId) found.userId = 'اختر الموظف';
    if (Object.keys(found).length > 0) {
      setFields(found);
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    const input = {
      branchId,
      vanBranchId: vanId || null,
      mode,
      maxDiscountBp: bp,
      dailyCreditLimitMinor: creditMinor,
      commissionPlanId: planId || null,
    };
    try {
      if (rep) await updateRep(rep.id, { ...input, version: rep.version });
      else await createRep({ ...input, userId });
      onSaved();
    } catch (e) {
      const failed = saveFailure(e);
      setFields(failed.fields);
      setError(failed.message);
      setSaving(false);
    }
  }

  const freeVans = vans.filter((v) => v.isActive && (!v.repId || v.repId === rep?.id));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={rep ? `تعديل ${rep.userName}` : 'مندوب جديد'}
      description="المندوب موظف له دور «مندوب مبيعات». اختر سيارته وحدوده."
    >
      <form
        aria-label={rep ? 'تعديل المندوب' : 'مندوب جديد'}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!rep ? (
          candidates.length === 0 ? (
            <Alert tone="info">
              لا موظف بدور «مندوب مبيعات» بلا ملف مندوب. أضف موظفاً بهذا الدور من صفحة الموظفين أولاً.
            </Alert>
          ) : (
            <Select
              label="الموظف"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              error={fields.userId}
            >
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </Select>
          )
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="يُحاسَب في فرع"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            error={fields.branchId}
          >
            {me.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            label="سيارته"
            value={vanId}
            onChange={(e) => setVanId(e.target.value)}
            error={fields.vanBranchId}
          >
            <option value="">بلا سيارة</option>
            {freeVans.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Select
            label="طريقة عمله"
            value={mode}
            onChange={(e) => setMode(e.target.value as RepMode)}
            error={fields.mode}
          >
            {REP_MODES.map((m) => (
              <option key={m} value={m}>
                {REP_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
          <Select
            label="خطة العمولة"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            error={fields.commissionPlanId}
          >
            <option value="">بلا عمولة</option>
            {plans
              .filter((p) => p.isActive || p.id === rep?.commissionPlanId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <TextField
            label="أكبر خصم يمنحه %"
            hint="فارغ: حسب دوره"
            inputMode="decimal"
            dir="ltr"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            error={fields.maxDiscountBp}
          />
          <TextField
            label="أكبر دين في اليوم"
            hint="فارغ: بلا حد"
            inputMode="numeric"
            dir="ltr"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            error={fields.dailyCreditLimitMinor}
          />
        </div>
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving} disabled={!rep && candidates.length === 0}>
            احفظ
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «المندوبون»: who sells in the market, from which van, and within which limits */
export function RepsPage() {
  const { data, error, reload } = useLoad(listReps);
  const vans = useLoad(listVans);
  const plans = useLoad(listPlans);
  // What each rep owes after a shortage; a supervisor without the settling permission just sees no column
  const debts = useLoad(listRepDebts);
  const owes = new Map((debts.data ?? []).map((d) => [d.repId, d.balanceMinor]));
  const base = useMe().settings.baseCurrency;
  const [debtOf, setDebtOf] = useState<RepRow | null>(null);
  const [editing, setEditing] = useState<RepRow | 'new' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(rep: RepRow) {
    setProblem(null);
    try {
      await setRepActive(rep.id, !rep.isActive);
      reload();
    } catch (e) {
      setProblem(errorMessage(e));
    }
  }

  const columns: DataColumn<RepRow>[] = [
    {
      key: 'name',
      header: 'المندوب',
      cell: (r) => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="font-semibold">{r.userName}</span>
          <span className="text-xs text-ink-muted">
            {REP_MODE_LABELS[r.mode]} · {r.branchName}
          </span>
        </div>
      ),
    },
    {
      key: 'van',
      header: 'السيارة',
      className: 'hidden sm:table-cell',
      cell: (r) => r.vanName ?? <span className="text-ink-muted">بلا سيارة</span>,
    },
    {
      key: 'phone',
      header: 'جواله',
      className: 'hidden md:table-cell',
      cell: (r) => r.deviceName ?? <span className="text-ink-muted">لم يُربط بعد</span>,
    },
    {
      key: 'routes',
      header: 'خطوطه',
      className: 'hidden sm:table-cell',
      cell: (r) => countNoun(r.routeCount, ROUTE_NOUN),
    },
    ...(debts.data
      ? [
          {
            key: 'debt',
            header: 'عليه',
            cell: (r: RepRow) => {
              const owed = owes.get(r.id) ?? 0;
              return owed > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setDebtOf(r)}>
                  <Money minor={owed} currency={base} />
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setDebtOf(r)}>
                  <span className="text-ink-muted">لا شيء</span>
                </Button>
              );
            },
          } satisfies DataColumn<RepRow>,
        ]
      : []),
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (r.isActive ? <Badge tone="success">يعمل</Badge> : <Badge>موقوف</Badge>),
    },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={() => setEditing(r)}>
            عدّل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggle(r)}>
            {r.isActive ? 'أوقف' : 'أعد التشغيل'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="المندوبون"
        description="مندوبو المبيعات في الميدان. يربط المندوب جواله بسيارته من «الأجهزة»."
        icon={<UserIcon />}
        actions={
          <Button icon={<AddIcon />} onClick={() => setEditing('new')}>
            مندوب جديد
          </Button>
        }
      />
      {error || problem ? <Alert tone="error">{error ?? problem}</Alert> : null}
      <DataTable
        caption="المندوبون"
        columns={columns}
        rows={data ?? []}
        rowKey={(r) => r.id}
        loading={!data && !error}
        empty={
          <EmptyState
            icon={UserIcon}
            title="لا مندوبين بعد."
            description="أضف موظفاً بدور «مندوب مبيعات» من صفحة الموظفين، ثم اجعله مندوباً هنا."
          />
        }
      />
      {debtOf ? (
        <RepDebtDialog
          repId={debtOf.id}
          repName={debtOf.userName}
          onClose={() => setDebtOf(null)}
          onChanged={debts.reload}
        />
      ) : null}
      {editing ? (
        <RepDialog
          rep={editing === 'new' ? null : editing}
          vans={vans.data ?? []}
          plans={plans.data ?? []}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            vans.reload();
          }}
        />
      ) : null}
    </>
  );
}
