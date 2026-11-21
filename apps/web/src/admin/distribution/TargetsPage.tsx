import { useEffect, useState, type FormEvent } from 'react';
import {
  getCurrency,
  TARGET_METRIC_LABELS,
  TARGET_METRICS,
  type RepTargetRow,
  type TargetMetric,
  type TargetScope,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  formatQuantity,
  Money,
  PageHeader,
  ProgressBar,
  Select,
  TextField,
  TruckIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { listCategories } from '../catalog/api';
import { createTarget, deleteTarget, listReps, listTargets, updateTarget } from './api';
import { FormFooter, thousandths, useLoad, wholeNumber } from './parts';
import { minorOf } from './SettlementPage';

/** «2026-11» of this month, and of the one `back` months before it */
export function monthOf(back = 0, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

const MONTH_NAMES = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
];
export const monthName = (month: string) =>
  `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** A target's figure as words: money in the store's currency, a quantity as pieces, a count as it is */
export function TargetValue({ metric, value, base }: { metric: TargetMetric; value: number; base: string }) {
  if (metric === 'net_sales' || metric === 'collections')
    return <Money minor={value} currency={base as never} />;
  if (metric === 'qty') return <bdi className="num">{formatQuantity(value)}</bdi>;
  return <bdi className="num">{value}</bdi>;
}

/** The typed figure of a target in the units the server keeps (minor units, thousandths, a count) */
export function targetFigure(metric: TargetMetric, text: string, decimals: number): number | null {
  if (metric === 'net_sales' || metric === 'collections') return minorOf(text, decimals);
  if (metric === 'qty') return thousandths(text);
  return wholeNumber(text, 1, 1_000_000);
}

function TargetDialog({
  month,
  existing,
  onDone,
  onCancel,
}: {
  month: string;
  existing: RepTargetRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const reps = useLoad(listReps);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [repId, setRepId] = useState(existing?.repId ?? '');
  const [metric, setMetric] = useState<TargetMetric>(existing?.metric ?? 'net_sales');
  const [scope, setScope] = useState<TargetScope>('all');
  const [categoryId, setCategoryId] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const list = (reps.data ?? []).filter((r) => r.isActive);
  const chosen = repId || list[0]?.id || '';
  const decimals = getCurrency(me.settings.baseCurrency).decimals;
  const counted = metric === 'net_sales' || metric === 'qty';

  useEffect(() => {
    listCategories()
      .then((r) =>
        setCategories(r.items.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name }))),
      )
      .catch(() => setCategories([]));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const figure = targetFigure(metric, value, decimals);
    if (figure === null) {
      setError('اكتب رقم الهدف.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) await updateTarget(existing.id, figure, existing.version);
      else {
        const { start, end } = monthBounds(month);
        await createTarget({
          repId: chosen,
          periodStart: start,
          periodEnd: end,
          metric,
          scope: counted && scope === 'category' ? 'category' : 'all',
          productId: null,
          categoryId: counted && scope === 'category' ? categoryId : null,
          targetValue: figure,
        });
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={existing ? 'تعديل الهدف' : `هدف جديد · ${monthName(month)}`}
      description="الهدف للمتابعة فقط: لا يُرحِّل شيئاً ولا يمنع بيعاً."
    >
      <form aria-label="هدف" className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {existing ? (
          <p className="text-sm">
            {existing.repName} · {TARGET_METRIC_LABELS[existing.metric]}
          </p>
        ) : (
          <>
            <Select label="المندوب" value={chosen} onChange={(e) => setRepId(e.target.value)}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.userName}
                </option>
              ))}
            </Select>
            <Select
              label="المقياس"
              value={metric}
              onChange={(e) => setMetric(e.target.value as TargetMetric)}
            >
              {TARGET_METRICS.map((m) => (
                <option key={m} value={m}>
                  {TARGET_METRIC_LABELS[m]}
                </option>
              ))}
            </Select>
            {counted ? (
              <Select
                label="يُحسب على"
                value={scope}
                onChange={(e) => setScope(e.target.value as TargetScope)}
              >
                <option value="all">كل المنتجات</option>
                <option value="category">تصنيف</option>
              </Select>
            ) : null}
            {counted && scope === 'category' ? (
              <Select label="التصنيف" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">اختر التصنيف</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        )}
        <TextField
          label={
            metric === 'net_sales' || metric === 'collections'
              ? `الهدف بـ ${me.settings.baseCurrency}`
              : metric === 'qty'
                ? 'الهدف بالقطع'
                : 'عدد الزبائن'
          }
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 15))}
          inputClassName="num"
        />
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            تراجع
          </Button>
          <Button type="submit" loading={saving} disabled={!existing && !chosen}>
            احفظ
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** «الأهداف»: what each rep should reach this month, against what he has reached (for follow-up only) */
export function TargetsPage() {
  const me = useMe();
  const months = Array.from({ length: 6 }, (_, i) => monthOf(i - 1));
  const [month, setMonth] = useState(monthOf());
  const [rows, setRows] = useState<RepTargetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RepTargetRow | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    listTargets(month)
      .then((r) => {
        if (live) {
          setRows(r);
          setError(null);
        }
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [month, version]);

  const base = me.settings.baseCurrency;
  const columns: DataColumn<RepTargetRow>[] = [
    {
      key: 'rep',
      header: 'المندوب',
      cell: (t) => (
        <div className="flex flex-col gap-0.5 py-2">
          <span className="font-semibold">{t.repName}</span>
          <span className="text-xs text-ink-muted">
            {TARGET_METRIC_LABELS[t.metric]}
            {t.scopeName ? ` · ${t.scopeName}` : ''}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
              عدّل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void deleteTarget(t.id)
                  .then(() => setVersion((v) => v + 1))
                  .catch((e: unknown) => setError(errorMessage(e)))
              }
            >
              احذف
            </Button>
          </div>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'الهدف',
      numeric: true,
      cell: (t) => <TargetValue metric={t.metric} value={t.targetValue} base={base} />,
    },
    {
      key: 'actual',
      header: 'المحقق',
      numeric: true,
      cell: (t) => <TargetValue metric={t.metric} value={t.actualValue} base={base} />,
    },
    {
      key: 'percent',
      header: 'النسبة',
      cell: (t) =>
        t.percent === null ? (
          '—'
        ) : (
          <div className="flex flex-col gap-1">
            <Badge tone={t.percent >= 100 ? 'success' : 'neutral'}>
              <span className="num">{t.percent}٪</span>
            </Badge>
            <ProgressBar
              label={`تحقيق ${t.repName}`}
              value={Math.min(t.percent, 100)}
              tone={t.percent >= 100 ? 'success' : 'brand'}
            />
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="الأهداف"
        description="هدف كل مندوب في الشهر، وما حققه حتى الآن. للمتابعة فقط."
        icon={<TruckIcon />}
        actions={<Button onClick={() => setEditing('new')}>هدف جديد</Button>}
      />
      <Select label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthName(m)}
          </option>
        ))}
      </Select>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="الأهداف"
        columns={columns}
        rows={rows ?? []}
        rowKey={(t) => t.id}
        loading={!rows && !error}
        empty={
          <EmptyState
            icon={TruckIcon}
            title="لا أهداف لهذا الشهر."
            description="ضع لكل مندوب هدفاً من المبيعات أو التحصيل أو الزبائن الجدد."
          />
        }
      />
      {editing ? (
        <TargetDialog
          month={month}
          existing={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </>
  );
}
