import { useState } from 'react';
import type { ControlledRegisterResponse, ControlledRegisterRow } from '@serva/core';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  formatQuantity,
  PageHeader,
  PrintIcon,
  SegmentedControl,
  ShieldCheckIcon,
  Skeleton,
  StatTile,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { useReport } from '../reports/useReport';
import { getControlledRegister } from './api';
import { DateField } from '../../lib/DateField';

type Period = 'day' | 'month';

/** Why a row is there, in the words of the shelf. */
const KIND_TEXT: Record<string, string> = {
  sale: 'بيع',
  return: 'مرتجع',
  purchase: 'استلام',
  stocktake: 'جرد',
  transfer: 'تحويل',
  supplier_return: 'إرجاع للمورد',
};

/** The first and last day of the chosen day or month: «2026-10» gives 2026-10-01 to 2026-10-31. */
export function rangeOf(period: Period, value: string): { from: string; to: string } {
  if (period === 'day') return { from: value, to: value };
  const [year = 0, month = 1] = value.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${value}-01`, to: `${value}-${String(last).padStart(2, '0')}` };
}

/**
 * «سجل الأدوية المراقبة» (03 › الصيدليات): every movement of a controlled drug in a day or a month
 * (the sale with its prescription, doctor, patient and ID, the return, the receipt) with the
 * running balance, printable for the authorities. The register is read from the documents and
 * checked against the stock: a difference shows as a warning above it.
 */
export function ControlledRegisterPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [period, setPeriod] = useState<Period>('day');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const { from, to } = rangeOf(period, period === 'day' ? day : month);
  const { data, error, loading, retry } = useReport(`${from}|${to}`, () => getControlledRegister(from, to));
  const { paper, print } = usePrint();

  const qty = (n: number) =>
    n === 0 ? <span className="text-ink-subtle">—</span> : formatQuantity(n, digits);
  const dash = <span className="text-ink-subtle">—</span>;
  const mismatched = data?.balances.filter((b) => !b.matches) ?? [];

  const columns: DataColumn<ControlledRegisterRow>[] = [
    {
      key: 'date',
      className: 'whitespace-nowrap',
      header: 'التاريخ',
      cell: (r) => <bdi className="num">{r.date}</bdi>,
    },
    { key: 'item', header: 'الصنف', cell: (r) => r.item },
    {
      key: 'batch',
      className: 'whitespace-nowrap',
      header: 'الدفعة',
      cell: (r) =>
        r.batchNo ? (
          <bdi dir="ltr" className="num">
            {r.batchNo}
          </bdi>
        ) : (
          dash
        ),
    },
    {
      key: 'doc',
      className: 'whitespace-nowrap',
      header: 'المستند',
      cell: (r) => (
        <span className="flex flex-col items-start">
          <span className="text-xs text-ink-subtle">{KIND_TEXT[r.kind] ?? r.kind}</span>
          {r.document ? (
            <bdi dir="ltr" className="num text-sm">
              {r.document}
            </bdi>
          ) : null}
        </span>
      ),
    },
    {
      key: 'rx',
      className: 'whitespace-nowrap',
      header: 'الوصفة والطبيب',
      cell: (r) =>
        r.prescriptionRef || r.doctor ? (
          <span className="flex flex-col items-start">
            <bdi dir="ltr" className="num text-sm">
              {r.prescriptionRef ?? '—'}
            </bdi>
            <span className="text-xs text-ink-muted">{r.doctor ?? '—'}</span>
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'patient',
      className: 'whitespace-nowrap',
      header: 'المريض وهويته',
      cell: (r) =>
        r.patientName || r.patientId ? (
          <span className="flex flex-col items-start">
            <span className="text-sm">{r.patientName ?? '—'}</span>
            <bdi dir="ltr" className="num text-xs text-ink-muted">
              {r.patientId ?? '—'}
            </bdi>
          </span>
        ) : (
          dash
        ),
    },
    { key: 'in', header: 'وارد', numeric: true, cell: (r) => qty(r.qtyIn) },
    { key: 'out', header: 'صادر', numeric: true, cell: (r) => qty(r.qtyOut) },
    { key: 'balance', header: 'الرصيد', numeric: true, cell: (r) => formatQuantity(r.balance, digits) },
  ];

  return (
    <AppShell>
      <title>سجل الأدوية المراقبة · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="سجل الأدوية المراقبة"
          description="كل حركة لدواء مراقَب: البيع بوصفته ومريضه، والمرتجع، والاستلام، مع الرصيد بعد كل حركة."
          actions={
            <Button variant="secondary" icon={<PrintIcon />} disabled={!data} onClick={() => print('A4')}>
              اطبع
            </Button>
          }
        />
        {mismatched.length > 0 ? (
          <Alert tone="warning">
            رصيد السجل لا يطابق المخزون:{' '}
            {mismatched
              .map(
                (b) =>
                  `${b.item} (السجل ${formatQuantity(b.registerQty, digits)} والمخزون ${formatQuantity(b.stockQty, digits)})`,
              )
              .join('، ')}
            . راجع الجرد والتسويات، فكل نقص بلا مستند يجب أن يُفسَّر.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
          <StatTile
            label="حركات الفترة"
            value={data ? data.rows.length : <Skeleton className="h-9 w-12" />}
          />
          <StatTile
            label="أصناف مراقَبة"
            value={data ? data.balances.length : <Skeleton className="h-9 w-12" />}
          />
          <StatTile
            label="مطابقة المخزون"
            value={data ? data.matches ? 'مطابق' : 'غير مطابق' : <Skeleton className="h-9 w-16" />}
          />
        </div>
        <section aria-label="الحركات" className="flex flex-col gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <SegmentedControl
              label="الفترة"
              value={period}
              onValueChange={setPeriod}
              options={[
                { value: 'day', label: 'يومي' },
                { value: 'month', label: 'شهري' },
              ]}
            />
            {period === 'day' ? (
              <DateField label="اليوم" value={day} max={today} required onChange={setDay} />
            ) : (
              <TextField
                label="الشهر"
                type="month"
                dir="ltr"
                value={month}
                max={today.slice(0, 7)}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
            )}
          </div>
          <DataTable
            caption="حركات الأدوية المراقبة"
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(r) => `${r.date}-${r.variantId}-${r.document ?? r.kind}-${r.balance}`}
            loading={loading && !error}
            {...(error ? { onRetry: retry } : {})}
            empty={
              <EmptyState
                icon={ShieldCheckIcon}
                title="لا حركة لدواء مراقَب في هذه الفترة."
                description="يظهر هنا كل بيع أو مرتجع أو استلام لصنف موسوم «مراقَب»."
              />
            }
          />
        </section>
        {data && paper ? (
          <PrintSheet paper={paper}>
            <RegisterSheet data={data} store={me.tenant.name} />
          </PrintSheet>
        ) : null}
      </div>
    </AppShell>
  );
}

const SHEET_HEADS = [
  'التاريخ',
  'الصنف',
  'الدفعة',
  'المستند',
  'الوصفة',
  'الطبيب',
  'المريض',
  'الهوية',
  'وارد',
  'صادر',
  'الرصيد',
];

/** The register as it is handed to the authorities: the store, the period, a plain table. */
function RegisterSheet({ data, store }: { data: ControlledRegisterResponse; store: string }) {
  const digits = useDigits();
  const n = (v: number) => (v === 0 ? '' : formatQuantity(v, digits));
  return (
    <div dir="rtl" className="flex flex-col gap-3 p-2 text-xs text-ink">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <p className="text-base font-bold">{store}</p>
        <div className="text-end">
          <p className="text-lg font-bold">سجل الأدوية المراقبة</p>
          <p>
            من {dayText(data.from, digits)} إلى {dayText(data.to, digits)}
          </p>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink">
            {SHEET_HEADS.map((h) => (
              <th key={h} className="px-1 py-1 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              <td className="px-1 py-1">{r.date}</td>
              <td className="px-1 py-1">{r.item}</td>
              <td className="px-1 py-1">{r.batchNo ?? ''}</td>
              <td className="px-1 py-1">{r.document ?? KIND_TEXT[r.kind] ?? r.kind}</td>
              <td className="px-1 py-1">{r.prescriptionRef ?? ''}</td>
              <td className="px-1 py-1">{r.doctor ?? ''}</td>
              <td className="px-1 py-1">{r.patientName ?? ''}</td>
              <td className="px-1 py-1">{r.patientId ?? ''}</td>
              <td className="px-1 py-1">{n(r.qtyIn)}</td>
              <td className="px-1 py-1">{n(r.qtyOut)}</td>
              <td className="px-1 py-1 font-semibold">{formatQuantity(r.balance, digits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.matches ? null : (
        <p className="font-semibold">تنبيه: رصيد السجل لا يطابق المخزون الحالي لبعض الأصناف.</p>
      )}
    </div>
  );
}
