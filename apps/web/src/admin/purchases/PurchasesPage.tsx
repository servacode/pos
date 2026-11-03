import { useCallback, useEffect, useState } from 'react';
import type { PurchasePayment, PurchaseRow, SupplierListResponse, SupplierRow } from '@serva/core';
import {
  Alert,
  Button,
  cn,
  DataTable,
  DeleteIcon,
  Money,
  Select,
  StatTile,
  TextField,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import {
  createPurchase,
  createSupplier,
  listPurchases,
  listSuppliers,
  moneyOf,
  paySupplier,
  qtyOf,
  today,
} from './api';
import { VariantPicker, type PickedVariant } from './VariantPicker';

const PAYMENT_TEXT: Record<PurchasePayment, string> = {
  credit: 'على حساب المورد',
  cash: 'نقداً من الخزنة',
  bank: 'من البنك',
};

interface Line extends PickedVariant {
  qty: string;
  cost: string;
}

/**
 * «المشتريات» (08 › فاتورة شراء): the suppliers and what is owed to each, the purchases, a new
 * purchase (goods into the stock at what they cost) and a payment to a supplier.
 */
export function PurchasesPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'buy' | 'pay' | 'supplier'>('list');

  const load = useCallback(() => {
    setError(null);
    Promise.all([listSuppliers(), listPurchases()])
      .then(([s, p]) => {
        setSuppliers(s);
        setPurchases(p.items);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const base = suppliers?.baseCurrency ?? 'SYP';
  const done = (message: string) => {
    setNotice(message);
    setMode('list');
    load();
  };

  const purchaseColumns: DataColumn<PurchaseRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      cell: (p) => (
        <bdi dir="ltr" className="num font-semibold">
          {p.number}
        </bdi>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (p) => <span className="num">{p.date}</span> },
    { key: 'supplier', header: 'المورد', cell: (p) => p.supplierName },
    { key: 'payment', header: 'الدفع', cell: (p) => PAYMENT_TEXT[p.payment] },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      cell: (p) => <Money minor={p.totalMinor} currency={base} />,
    },
  ];
  const supplierColumns: DataColumn<SupplierRow>[] = [
    { key: 'name', header: 'المورد', cell: (s) => <span className="font-semibold">{s.name}</span> },
    {
      key: 'phone',
      header: 'الجوال',
      cell: (s) =>
        s.phone ? (
          <bdi dir="ltr" className="num">
            {s.phone}
          </bdi>
        ) : (
          '—'
        ),
    },
    {
      key: 'balance',
      header: 'له علينا',
      numeric: true,
      cell: (s) => <Money minor={s.balanceMinor} currency={base} className="font-semibold" />,
    },
  ];

  return (
    <AppShell>
      <title>المشتريات · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold text-ink">المشتريات والموردون</h1>
          {mode === 'list' ? (
            <>
              <Button onClick={() => setMode('buy')} disabled={!suppliers?.items.length}>
                فاتورة شراء
              </Button>
              <Button variant="secondary" onClick={() => setMode('pay')} disabled={!suppliers?.items.length}>
                دفعة لمورد
              </Button>
              <Button variant="secondary" onClick={() => setMode('supplier')}>
                مورد جديد
              </Button>
            </>
          ) : null}
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice && mode === 'list' ? <Alert tone="success">{notice}</Alert> : null}
        {suppliers && suppliers.items.length === 0 && mode === 'list' ? (
          <Alert tone="info">أضف مورداً أولاً، ثم سجّل فواتير الشراء منه.</Alert>
        ) : null}
        {mode === 'supplier' ? (
          <SupplierForm onSaved={() => done('أُضيف المورد.')} onCancel={() => setMode('list')} />
        ) : null}
        {mode === 'buy' && suppliers ? (
          <PurchaseForm
            suppliers={suppliers.items}
            onSaved={(n) => done(`سُجّلت الفاتورة ${n} ودخلت البضاعة المخزون.`)}
            onCancel={() => setMode('list')}
          />
        ) : null}
        {mode === 'pay' && suppliers ? (
          <PaymentForm
            suppliers={suppliers.items}
            onSaved={(n) => done(`سُجّل سند الدفع ${n}.`)}
            onCancel={() => setMode('list')}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="المستحق للموردين"
            value={<Money minor={suppliers?.totalOwedMinor ?? 0} currency={base} />}
          />
          <StatTile label="عدد الفواتير" value={purchases?.length ?? 0} />
        </div>
        <DataTable
          caption="الموردون"
          columns={supplierColumns}
          rows={suppliers?.items ?? []}
          rowKey={(s) => s.id}
          loading={!suppliers && !error}
          empty="لا موردين بعد."
        />
        <DataTable
          caption="فواتير الشراء"
          columns={purchaseColumns}
          rows={purchases ?? []}
          rowKey={(p) => p.id}
          loading={!purchases && !error}
          empty="لا فواتير شراء بعد."
        />
      </div>
    </AppShell>
  );
}

function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      return await work();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, fields, run, setFields };
}

function SupplierForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const s = useSaving();
  return (
    <form
      aria-label="مورد جديد"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(() => createSupplier({ name, phone })).then((r) => r && onSaved());
      }}
    >
      {s.error && !Object.keys(s.fields).length ? <Alert tone="error">{s.error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="اسم المورد"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={s.fields.name}
        />
        <TextField
          label="الجوال"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={s.fields.phone}
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={s.saving}>
          احفظ
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

function PurchaseForm({
  suppliers,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [payment, setPayment] = useState<PurchasePayment>('credit');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const s = useSaving();
  const parsed = lines.map((l) => ({ qty: qtyOf(l.qty), cost: moneyOf(l.cost) }));
  const ready = lines.length > 0 && parsed.every((p) => p.qty && p.qty > 0 && p.cost !== null);
  const total = parsed.reduce((sum, p) => sum + (p.cost ?? 0), 0);

  return (
    <form
      aria-label="فاتورة شراء"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void s
          .run(() =>
            createPurchase({
              supplierId,
              date,
              payment,
              reference: reference || null,
              notes: null,
              lines: lines.map((l, i) => ({
                variantId: l.variantId,
                qty: parsed[i]!.qty!,
                costMinor: parsed[i]!.cost!,
              })),
            }),
          )
          .then((r) => r && onSaved(r.number));
      }}
    >
      {s.error ? <Alert tone="error">{s.error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="المورد" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          {suppliers.map((sup) => (
            <option key={sup.id} value={sup.id}>
              {sup.name}
            </option>
          ))}
        </Select>
        <TextField
          label="التاريخ"
          type="date"
          dir="ltr"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          label="رقم فاتورة المورد"
          dir="ltr"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div role="group" aria-label="الدفع" className="flex flex-wrap gap-2">
        {(Object.keys(PAYMENT_TEXT) as PurchasePayment[]).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={payment === p}
            onClick={() => setPayment(p)}
            className={cn(
              'min-h-11 rounded-control border-2 px-4 font-semibold',
              payment === p ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink',
            )}
          >
            {PAYMENT_TEXT[p]}
          </button>
        ))}
      </div>
      <VariantPicker
        onPick={(v) =>
          setLines((list) =>
            list.some((l) => l.variantId === v.variantId) ? list : [...list, { ...v, qty: '', cost: '' }],
          )
        }
      />
      {lines.length > 0 ? (
        <ul aria-label="أصناف الفاتورة" className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={l.variantId} className="grid grid-cols-[minmax(0,1fr)_8rem_10rem_auto] items-end gap-3">
              <span className="pb-3 font-semibold text-ink">{l.name}</span>
              <TextField
                label={`كمية ${l.name}`}
                inputMode="decimal"
                dir="ltr"
                value={l.qty}
                onChange={(e) =>
                  setLines((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                }
                error={s.fields[`lines.${i}.qty`]}
              />
              <TextField
                label={`كلفة ${l.name}`}
                hint="مجموع السطر بالليرة"
                inputMode="decimal"
                dir="ltr"
                value={l.cost}
                onChange={(e) =>
                  setLines((all) => all.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))
                }
                error={s.fields[`lines.${i}.costMinor`]}
              />
              <button
                type="button"
                aria-label={`احذف ${l.name}`}
                onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                className="grid size-12 place-items-center rounded-xl text-ink-muted hover:bg-surface-muted"
              >
                <DeleteIcon size={20} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between rounded-card bg-surface-total p-4">
        <span className="font-semibold text-ink-muted">مجموع الفاتورة</span>
        <Money minor={total} currency="SYP" className="text-2xl font-bold text-ink" />
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={s.saving} disabled={!ready}>
          سجّل الفاتورة
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({
  suppliers,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const owing = suppliers.filter((x) => x.balanceMinor > 0);
  const [supplierId, setSupplierId] = useState((owing[0] ?? suppliers[0])?.id ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [date, setDate] = useState(today());
  const s = useSaving();
  const minor = moneyOf(amount);
  return (
    <form
      aria-label="دفعة لمورد"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!minor) return;
        void s
          .run(() => paySupplier({ supplierId, date, amountMinor: minor, method, note: null }))
          .then((r) => r && onSaved(r.number));
      }}
    >
      {s.error ? <Alert tone="error">{s.error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="المورد" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          {suppliers.map((sup) => (
            <option key={sup.id} value={sup.id}>
              {sup.name}
            </option>
          ))}
        </Select>
        <TextField
          label="المبلغ بالليرة"
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label="التاريخ"
          type="date"
          dir="ltr"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div role="group" aria-label="من أين" className="flex gap-2">
        {(['cash', 'bank'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            onClick={() => setMethod(m)}
            className={cn(
              'min-h-11 rounded-control border-2 px-4 font-semibold',
              method === m ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-ink',
            )}
          >
            {m === 'cash' ? 'من الخزنة' : 'من البنك'}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={s.saving} disabled={!minor}>
          سجّل الدفعة
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
