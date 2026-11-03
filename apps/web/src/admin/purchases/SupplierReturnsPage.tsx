import { useCallback, useEffect, useState } from 'react';
import type {
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierReturnInput,
  SupplierReturnRow,
} from '@serva/core';
import { Alert, Button, DataTable, Money, Select, TextField, type DataColumn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, ApiError, errorMessage } from '../../lib/api';
import { listSuppliers, moneyOf, qtyOf, today } from './api';
import { VariantPicker } from './VariantPicker';

const listReturns = () => apiFetch<{ items: SupplierReturnRow[] }>('/v1/supplier-returns', { auth: true });
const createReturn = (input: SupplierReturnInput) =>
  apiFetch<SupplierReturnDetail>('/v1/supplier-returns', { method: 'POST', body: input, auth: true });

const REFUND_TEXT: Record<SupplierReturnRow['refund'], string> = {
  credit: 'من رصيده',
  cash: 'نقداً',
  bank: 'تحويل بنكي',
};

interface Line {
  variantId: string;
  name: string;
  qty: string;
  /** What the supplier credits for the line; empty means the pieces' cost */
  amount: string;
}

/**
 * «مرتجع إلى المورد» (09 › purchase returns): pieces sent back to their supplier, out of the branch
 * at their average cost. The supplier credits them off what the store owes it, or pays back in cash
 * or by bank; the amount is the pieces' cost unless typed.
 */
export function SupplierReturnsPage() {
  const me = useMe();
  const branches = me.branches;
  const base = me.settings.baseCurrency;
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [items, setItems] = useState<SupplierReturnRow[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [refund, setRefund] = useState<SupplierReturnRow['refund']>('credit');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<SupplierReturnDetail | null>(null);

  const load = useCallback(() => {
    listReturns()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    listSuppliers()
      .then((s) => {
        setSuppliers(s);
        setSupplierId((id) => id || (s.items.find((x) => !x.archived)?.id ?? ''));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const parsed = lines.map((l) => ({
    qty: qtyOf(l.qty),
    amount: l.amount.trim() ? moneyOf(l.amount) : undefined,
  }));
  const ready =
    supplierId && lines.length > 0 && parsed.every((p) => p.qty !== null && p.qty > 0 && p.amount !== null);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      setDone(
        await createReturn({
          supplierId,
          branchId: branchId || undefined,
          date: today(),
          refund,
          reference: reference.trim() || null,
          note: note.trim() || null,
          lines: lines.map((l, i) => ({
            variantId: l.variantId,
            qty: parsed[i]!.qty!,
            amountMinor: parsed[i]!.amount ?? null,
          })),
        }),
      );
      setLines([]);
      setReference('');
      setNote('');
      load();
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  const columns: DataColumn<SupplierReturnRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.number}
        </bdi>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (r) => <span className="num">{r.date}</span> },
    { key: 'supplier', header: 'المورد', cell: (r) => r.supplierName },
    { key: 'refund', header: 'الاسترداد', cell: (r) => REFUND_TEXT[r.refund] },
    {
      key: 'pieces',
      header: 'القطع',
      numeric: true,
      cell: (r) => <span className="num">{r.pieces / 1000}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (r) => <Money minor={r.amountMinor} currency={base} />,
    },
  ];

  const active = (suppliers?.items ?? []).filter((s) => !s.archived);
  return (
    <AppShell>
      <title>مرتجع إلى المورد · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">مرتجع إلى المورد</h1>
        <section
          aria-label="مرتجع جديد"
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          {done ? (
            <Alert tone="success">
              سُجّل المرتجع {done.number}: <Money minor={done.amountMinor} currency={base} />{' '}
              {done.refund === 'credit' ? 'نزلت من رصيد المورد.' : 'استرددتها منه.'} خرجت القطع من المخزون.
            </Alert>
          ) : null}
          {suppliers && active.length === 0 ? (
            <Alert tone="info">لا موردين بعد. أضف المورد من «المشتريات».</Alert>
          ) : null}
          <div className="grid gap-4 md:grid-cols-3">
            <Select
              label="المورد"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              error={fields.supplierId}
            >
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {branches.length > 1 ? (
              <Select label="من فرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select
              label="الاسترداد"
              value={refund}
              onChange={(e) => setRefund(e.target.value as SupplierReturnRow['refund'])}
            >
              <option value="credit">من رصيده عندي</option>
              <option value="cash">نقداً</option>
              <option value="bank">تحويل بنكي</option>
            </Select>
            <TextField
              label="رقم إشعار المورد (اختياري)"
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value.slice(0, 64))}
            />
            <TextField
              label="السبب (اختياري)"
              placeholder="عيب خياطة، مقاس خطأ…"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
            />
          </div>
          <VariantPicker
            onPick={(v) =>
              setLines((list) =>
                list.some((l) => l.variantId === v.variantId)
                  ? list
                  : [...list, { ...v, qty: '', amount: '' }],
              )
            }
            onPickGrid={(picked) =>
              setLines((list) => [
                ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                ...picked.map((p) => ({ variantId: p.variantId, name: p.name, qty: p.qty, amount: '' })),
              ])
            }
          />
          {lines.length > 0 ? (
            <ul aria-label="أصناف المرتجع" className="flex flex-col gap-2">
              {lines.map((l, i) => (
                <li key={l.variantId} className="flex flex-wrap items-end gap-3">
                  <span className="flex-1 pb-3 font-semibold">{l.name}</span>
                  <TextField
                    label={`كمية ${l.name}`}
                    dir="ltr"
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                    }
                    error={fields[`lines.${i}.qty`]}
                    className="w-32"
                  />
                  <TextField
                    label={`مبلغ ${l.name}`}
                    hint="فارغ: بكلفتها"
                    dir="ltr"
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) =>
                      setLines((all) => all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                    }
                    className="w-40"
                  />
                  <Button variant="ghost" onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                    احذف
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button disabled={!ready} loading={saving} onClick={() => void save()}>
              سجّل المرتجع
            </Button>
          </div>
        </section>
        <DataTable
          caption="المرتجعات إلى الموردين"
          columns={columns}
          rows={items ?? []}
          rowKey={(r) => r.id}
          loading={!items && !error}
          empty="لا مرتجعات بعد."
        />
      </div>
    </AppShell>
  );
}
