import { useEffect, useState } from 'react';
import {
  EXPENSE_PAY_FROM,
  EXPENSE_PAY_FROM_LABEL,
  toMinor,
  type AccountRow,
  type CurrencyCode,
  type ExpensePayFrom,
  type ExpenseRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Money,
  ReportsIcon,
  Select,
  Skeleton,
  StatTile,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { isoDay, monthStart } from '../../lib/dates';
import { downloadText } from '../accounting/csv';
import {
  BranchSelect,
  DayField,
  PageHead,
  ReportFilters,
  ReportScreen,
  defaultBranch,
} from '../reports/parts';
import { listAccounts } from '../reports/api';
import { useReport } from '../reports/useReport';
import { createExpense, listExpenses, voidExpense } from './api';
import { expensesCsv } from './csv';

/** The default 61xx accounts, used when the caller may not read the chart (no accounting.view). */
const DEFAULT_EXPENSE_ACCOUNTS: Pick<AccountRow, 'code' | 'name'>[] = [
  { code: '6101', name: 'الإيجار' },
  { code: '6102', name: 'الكهرباء والأمبيرات والمحروقات' },
  { code: '6103', name: 'المياه' },
  { code: '6104', name: 'الهاتف والإنترنت' },
  { code: '6105', name: 'النقل والتوصيل' },
  { code: '6106', name: 'الصيانة والإصلاح' },
  { code: '6107', name: 'الدعاية والعينات والهدايا' },
  { code: '6108', name: 'الضيافة والنظافة والمستهلكات' },
  { code: '6109', name: 'القرطاسية والمطبوعات' },
  { code: '6110', name: 'الرواتب والأجور' },
  { code: '6170', name: 'الرسوم والتراخيص' },
  { code: '6180', name: 'الأتعاب المهنية واشتراكات البرامج' },
  { code: '6190', name: 'مصاريف متنوعة' },
];

/** The expense accounts of the chart a hand may post to (type expense, not a group, 6xxx). */
function useExpenseAccounts() {
  const [accounts, setAccounts] = useState<Pick<AccountRow, 'code' | 'name'>[]>(DEFAULT_EXPENSE_ACCOUNTS);
  useEffect(() => {
    let current = true;
    listAccounts().then(
      (r) => {
        const rows = r.items.filter((a) => a.type === 'expense' && !a.isGroup && /^6\d{3,5}$/.test(a.code));
        if (current && rows.length > 0) setAccounts(rows);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return accounts;
}

function NewExpense({
  accounts,
  onSaved,
  onCancel,
}: {
  accounts: Pick<AccountRow, 'code' | 'name'>[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const branches = me.branches;
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState(defaultBranch(me) ?? branches[0]?.id ?? '');
  const [accountCode, setAccountCode] = useState('6101');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(me.settings.baseCurrency);
  const [payFrom, setPayFrom] = useState<ExpensePayFrom>('safe');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // One id per form, so a retry after a lost answer records the expense once.
  const [requestId] = useState(() => crypto.randomUUID());

  let amountMinor: number | null = null;
  try {
    amountMinor = amount.trim() ? toMinor(amount, currency) : null;
  } catch {
    amountMinor = null;
  }
  const ready = amountMinor !== null && amountMinor > 0 && branchId !== '';

  async function submit() {
    if (!ready || amountMinor === null) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await createExpense({
        id: requestId,
        date,
        branchId,
        accountCode,
        amountMinor,
        currency,
        payFrom,
        note: note.trim() || null,
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="مصروف جديد"
      description="يُسجَّل قيده وحده: مدين حساب المصروف، ودائن المكان الذي دُفع منه."
    >
      <form
        aria-label="مصروف جديد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && Object.keys(fields).length === 0 ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="التاريخ"
            type="date"
            dir="ltr"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            error={fields.date}
          />
          <Select
            label="الفرع"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            error={fields.branchId}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <Select
          label="نوع المصروف"
          value={accountCode}
          onChange={(e) => setAccountCode(e.target.value)}
          error={fields.accountCode}
        >
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} {a.name}
            </option>
          ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <TextField
            label="المبلغ"
            inputMode="decimal"
            dir="ltr"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={
              fields.amountMinor ?? (amount.trim() && amountMinor === null ? 'مبلغ غير صالح' : undefined)
            }
          />
          <Select
            label="العملة"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            error={fields.currency ?? fields.rate}
          >
            {me.settings.enabledCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <Select
          label="دُفع من"
          value={payFrom}
          onChange={(e) => setPayFrom(e.target.value as ExpensePayFrom)}
          error={fields.payFrom}
          hint={
            currency !== me.settings.baseCurrency
              ? 'يُحسب بالعملة الأساسية بسعر الصرف الحالي للمتجر.'
              : 'مصروف الدرج أثناء الوردية يُسجَّل من شاشة الكاشير.'
          }
        >
          {EXPENSE_PAY_FROM.map((p) => (
            <option key={p} value={p}>
              {EXPENSE_PAY_FROM_LABEL[p]}
            </option>
          ))}
        </Select>
        <TextField
          label="ملاحظة"
          hint="اختياري"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={fields.note}
          maxLength={200}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            سجّل المصروف
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function VoidDialog({
  expense,
  onDone,
  onCancel,
}: {
  expense: ExpenseRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`إلغاء المصروف ${expense.number}`}
      description="لا يُحذف المصروف: يُسجَّل قيد عكسي ويبقى الأصل ظاهراً مشطوباً."
    >
      <form
        aria-label="إلغاء مصروف"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          voidExpense(expense.id, reason).then(onDone, (err: unknown) => {
            setError(errorMessage(err));
            setSaving(false);
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="سبب الإلغاء"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            رجوع
          </Button>
          <Button type="submit" loading={saving} disabled={reason.trim() === ''}>
            ألغِ المصروف
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * «المصاريف» (29): the store's expenses for a period, branch and kind, with totals by kind; a new
 * one posts its own entry, and a wrong one is cancelled by a reversing entry, never deleted.
 */
export function ExpensesPage() {
  const me = useMe();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [accountCode, setAccountCode] = useState<string | null>(null);
  const accounts = useExpenseAccounts();
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const { data, error, loading, retry } = useReport(
    `${from}|${to}|${branchId ?? ''}|${accountCode ?? ''}|${version}`,
    () => listExpenses({ from, to, branchId, accountCode }),
  );
  const base = data?.baseCurrency ?? me.settings.baseCurrency;

  const columns: DataColumn<ExpenseRow>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      cell: (e) => <bdi className="num whitespace-nowrap text-ink-muted">{e.date}</bdi>,
    },
    {
      key: 'what',
      header: 'المصروف',
      cell: (e) => (
        <div
          className={
            e.voided
              ? 'flex flex-col gap-0.5 py-2 line-through decoration-ink-subtle'
              : 'flex flex-col gap-0.5 py-2'
          }
        >
          <span className="font-semibold">
            <bdi className="num text-ink-subtle">{e.accountCode}</bdi> {e.accountName}
          </span>
          <span className="text-xs text-ink-muted">
            <bdi dir="ltr" className="num">
              {e.number}
            </bdi>
            {e.note ? ` · ${e.note}` : ''}
          </span>
        </div>
      ),
      total: 'المجموع',
    },
    {
      key: 'from',
      header: 'دُفع من',
      className: 'hidden md:table-cell',
      cell: (e) => EXPENSE_PAY_FROM_LABEL[e.payFrom],
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (e) => (
        <div className={e.voided ? 'flex flex-col items-end line-through' : 'flex flex-col items-end'}>
          <Money minor={e.amountMinor} currency={e.currency} className="font-semibold" />
          {e.currency !== base ? (
            <span className="text-xs text-ink-muted">
              <Money minor={e.baseAmountMinor} currency={base} />
            </span>
          ) : null}
        </div>
      ),
      total: data ? <Money minor={data.totalMinor} currency={base} /> : null,
    },
    {
      key: 'state',
      header: '',
      cell: (e) =>
        e.voided ? (
          <Badge tone="warning">ملغى</Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setVoiding(e)}>
            ألغِ
          </Button>
        ),
    },
  ];

  return (
    <ReportScreen me={me} access={['expenses.manage']} title="المصاريف">
      <PageHead
        icon={<ReportsIcon />}
        title="المصاريف"
        subtitle="الإيجار والكهرباء والرواتب وكل ما يخرج من المحل"
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!data || data.items.length === 0}
              onClick={() =>
                data && downloadText(`المصاريف-${from}-${to}.csv`, expensesCsv(data, data.items))
              }
            >
              صدّر CSV
            </Button>
            <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
              مصروف جديد
            </Button>
          </>
        }
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <ReportFilters>
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={setTo} />
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
        <Select
          label="النوع"
          value={accountCode ?? ''}
          onChange={(e) => setAccountCode(e.target.value || null)}
          className="min-w-48"
        >
          <option value="">كل الأنواع</option>
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} {a.name}
            </option>
          ))}
        </Select>
      </ReportFilters>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="مجموع المصاريف"
          value={
            data ? (
              <Money minor={data.totalMinor} currency={base} />
            ) : error ? (
              '—'
            ) : (
              <Skeleton className="h-9 w-40" />
            )
          }
        />
        <StatTile
          label="أكبر نوع"
          value={
            data ? (
              data.byAccount.length > 0 ? (
                <span className="text-lg">
                  {[...data.byAccount].sort((a, b) => b.totalMinor - a.totalMinor)[0]!.accountName}
                </span>
              ) : (
                '—'
              )
            ) : error ? (
              '—'
            ) : (
              <Skeleton className="h-9 w-40" />
            )
          }
        />
      </div>
      <DataTable
        caption="المصاريف"
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(e) => e.id}
        loading={loading}
        error={error ?? undefined}
        onRetry={retry}
        empty={
          <EmptyState
            icon={ReportsIcon}
            title="لا مصاريف في هذه الفترة."
            description="سجّل أول مصروف، فيظهر هنا وفي قائمة الدخل."
          />
        }
      />
      {data?.nextCursor ? (
        <Card className="text-sm text-ink-muted">
          يوجد مصاريف أقدم من هذه الصفحة؛ ضيّق الفترة أو النوع لتراها. المجموع أعلاه لكل الفترة.
        </Card>
      ) : null}
      {adding ? (
        <NewExpense
          accounts={accounts}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setNotice('سُجّل المصروف.');
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
      {voiding ? (
        <VoidDialog
          expense={voiding}
          onCancel={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            setNotice('أُلغي المصروف بقيد عكسي.');
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </ReportScreen>
  );
}
