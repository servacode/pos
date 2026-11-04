import { useCallback, useEffect, useState } from 'react';
import type { TransferDetail, TransferInput, TransferRow } from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Money,
  PageHeader,
  Select,
  TextField,
  TransferIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { qtyOf, today } from './api';
import { VariantPicker } from './VariantPicker';

const listTransfers = () => apiFetch<{ items: TransferRow[] }>('/v1/transfers', { auth: true });
const createTransfer = (input: TransferInput) =>
  apiFetch<TransferDetail>('/v1/transfers', { method: 'POST', body: input, auth: true });

interface Line {
  variantId: string;
  name: string;
  qty: string;
}

/**
 * «التحويل بين الفروع» (09 › transfers): goods sent from one branch to another in one step, out of
 * the sender at its average cost and into the receiver at that value; each branch's stock and books
 * move together. A model in sizes and colours opens as a grid, its quantities typed in one go.
 */
export function TransfersPage() {
  const me = useMe();
  const branches = me.branches;
  const base = me.settings.baseCurrency;
  const [items, setItems] = useState<TransferRow[] | null>(null);
  const [from, setFrom] = useState(branches[0]?.id ?? '');
  const [to, setTo] = useState(branches[1]?.id ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TransferDetail | null>(null);

  const load = useCallback(() => {
    listTransfers()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const parsed = lines.map((l) => qtyOf(l.qty));
  const ready = from && to && from !== to && lines.length > 0 && parsed.every((q) => q !== null && q > 0);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      setDone(
        await createTransfer({
          fromBranchId: from,
          toBranchId: to,
          date: today(),
          note: note.trim() || null,
          lines: lines.map((l, i) => ({ variantId: l.variantId, qty: parsed[i]! })),
        }),
      );
      setLines([]);
      setNote('');
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: DataColumn<TransferRow>[] = [
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
    { key: 'way', header: 'من ← إلى', cell: (r) => `${r.fromBranch} ← ${r.toBranch}` },
    {
      key: 'pieces',
      header: 'القطع',
      numeric: true,
      cell: (r) => <span className="num">{r.pieces / 1000}</span>,
    },
    {
      key: 'value',
      header: 'بالكلفة',
      numeric: true,
      cell: (r) => <Money minor={r.valueMinor} currency={base} />,
    },
  ];

  return (
    <AppShell>
      <title>التحويل بين الفروع · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={TransferIcon}
          title="التحويل بين الفروع"
          description="انقل بضاعة من فرع إلى آخر، وتتحرك مخازن الفرعين معاً"
        />
        {branches.length < 2 ? (
          <Alert tone="info">للمحل فرع واحد. التحويل يظهر حين يكون لك فرعان أو أكثر.</Alert>
        ) : (
          <section
            aria-label="تحويل جديد"
            className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
          >
            <CardHeader
              className="mb-0"
              icon={AddIcon}
              title="تحويل جديد"
              description="اختر الفرعين ثم الأصناف والكميات"
            />
            {error ? <Alert tone="error">{error}</Alert> : null}
            {done ? (
              <Alert tone="success">
                سُجّل التحويل {done.number} بكلفة <Money minor={done.valueMinor} currency={base} />. دخل مخزون
                الفرع الآخر.
              </Alert>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="من فرع" value={from} onChange={(e) => setFrom(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              <Select label="إلى فرع" value={to} onChange={(e) => setTo(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              <TextField
                label="ملاحظة (اختياري)"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
              />
            </div>
            {from === to ? <p className="text-sm text-danger-ink">اختر فرعين مختلفين.</p> : null}
            <VariantPicker
              onPick={(v) =>
                setLines((list) =>
                  list.some((l) => l.variantId === v.variantId) ? list : [...list, { ...v, qty: '' }],
                )
              }
              onPickGrid={(picked) =>
                setLines((list) => [
                  ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                  ...picked.map((p) => ({ variantId: p.variantId, name: p.name, qty: p.qty })),
                ])
              }
            />
            {lines.length > 0 ? (
              <ul aria-label="أصناف التحويل" className="flex flex-col gap-2">
                {lines.map((l, i) => (
                  <li key={l.variantId} className="flex items-end gap-3">
                    <span className="flex-1 pb-3 font-semibold">{l.name}</span>
                    <TextField
                      label={`كمية ${l.name}`}
                      dir="ltr"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) =>
                        setLines((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                      }
                      className="w-32"
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
                سجّل التحويل
              </Button>
            </div>
          </section>
        )}
        <Card>
          <CardHeader icon={TransferIcon} title="التحويلات السابقة" />
          <DataTable
            caption="التحويلات"
            columns={columns}
            rows={items ?? []}
            rowKey={(r) => r.id}
            loading={!items && !error}
            empty="لا تحويلات بعد."
          />
        </Card>
      </div>
    </AppShell>
  );
}
