import { useCallback, useEffect, useState } from 'react';
import type { TransferDetail, TransferInput, TransferRow } from '@serva/core';
import {
  Alert,
  BackIcon,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  formatQuantity,
  Money,
  PageHeader,
  Select,
  TextField,
  TransferIcon,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, errorMessage } from '../../lib/api';
import { qtyOf, today } from './api';
import { Caption, LinesHead, LinesTable, RemoveLine, SectionHead, WayArrow } from './parts';
import { VariantPicker } from './VariantPicker';

const listTransfers = () => apiFetch<{ items: TransferRow[] }>('/v1/transfers', { auth: true });
const createTransfer = (input: TransferInput) =>
  apiFetch<TransferDetail>('/v1/transfers', { method: 'POST', body: input, auth: true });

interface Line {
  variantId: string;
  name: string;
  qty: string;
}

/** The grid of a transfer line: the item, its quantity and the bin. */
const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_9rem_2.5rem]';

/**
 * «التحويل بين الفروع» (09 › transfers): goods sent from one branch to another in one step, out of
 * the sender at its average cost and into the receiver at that value; each branch's stock and books
 * move together. A model in sizes and colours opens as a grid, its quantities typed in one go.
 */
export function TransfersPage() {
  const me = useMe();
  const digits = useDigits();
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
  const pieces = parsed.reduce<number>((sum, q) => sum + (q ?? 0), 0);

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
      className: 'whitespace-nowrap',
      header: 'الرقم',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.number}
        </bdi>
      ),
    },
    {
      key: 'date',
      className: 'whitespace-nowrap',
      header: 'التاريخ',
      cell: (r) => <span className="num text-ink-muted">{r.date}</span>,
    },
    { key: 'way', header: 'من ← إلى', cell: (r) => <Route from={r.fromBranch} to={r.toBranch} /> },
    {
      key: 'pieces',
      header: 'القطع',
      numeric: true,
      cell: (r) => <span className="num">{formatQuantity(r.pieces, digits)}</span>,
    },
    {
      key: 'value',
      header: 'بالكلفة',
      numeric: true,
      cell: (r) => <Money minor={r.valueMinor} currency={base} className="font-semibold" />,
    },
  ];

  return (
    <AppShell>
      <title>التحويل بين الفروع · Serva POS</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="التحويل بين الفروع"
          description="بضاعة من فرع إلى آخر بكلفتها: مخزون كل فرع ودفاتره يتحرّكان معاً."
        />
        {branches.length < 2 ? (
          <EmptyState
            icon={TransferIcon}
            title="للمحل فرع واحد."
            description="التحويل يظهر حين يكون لك فرعان أو أكثر."
          />
        ) : (
          <section aria-label="تحويل جديد">
            <Card>
              <CardHeader
                icon={<TransferIcon />}
                title="تحويل جديد"
                description="اختر الفرعين، ثم أضف الأصناف بكمياتها."
              />
              <div className="flex flex-col gap-5">
                {error ? <Alert tone="error">{error}</Alert> : null}
                {done ? (
                  <Alert tone="success">
                    سُجّل التحويل {done.number} بكلفة <Money minor={done.valueMinor} currency={base} />. دخل
                    مخزون الفرع الآخر.
                  </Alert>
                ) : null}
                <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <Select label="من فرع" value={from} onChange={(e) => setFrom(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                  <WayArrow />
                  <Select
                    label="إلى فرع"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    error={from === to ? 'اختر فرعين مختلفين.' : undefined}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <TextField
                  label="ملاحظة (اختياري)"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                />
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
                  <LinesTable
                    label="أصناف التحويل"
                    head={
                      <LinesHead className={LINE_COLUMNS}>
                        <span>الصنف</span>
                        <span>الكمية</span>
                        <span />
                      </LinesHead>
                    }
                  >
                    {lines.map((l, i) => (
                      <li
                        key={l.variantId}
                        className={`grid grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:items-center ${LINE_COLUMNS}`}
                      >
                        <span className="min-w-0 truncate font-semibold text-ink md:self-center">
                          {l.name}
                        </span>
                        <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                          <Caption>الكمية</Caption>
                          <TextField
                            label={`كمية ${l.name}`}
                            hideLabel
                            dir="ltr"
                            inputMode="decimal"
                            value={l.qty}
                            onChange={(e) =>
                              setLines((all) =>
                                all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                              )
                            }
                            inputClassName="num"
                          />
                        </div>
                        <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                          <RemoveLine
                            name={l.name}
                            onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                          />
                        </div>
                      </li>
                    ))}
                  </LinesTable>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                  <p className="text-sm text-ink-muted">
                    {lines.length > 0 ? (
                      <>
                        الأصناف: <span className="num font-semibold text-ink">{lines.length}</span> · القطع:{' '}
                        <span className="num font-semibold text-ink">{formatQuantity(pieces, digits)}</span>
                      </>
                    ) : (
                      'ابحث عن صنف وأضفه بكميته.'
                    )}
                  </p>
                  <Button
                    icon={<TransferIcon />}
                    disabled={!ready}
                    loading={saving}
                    onClick={() => void save()}
                  >
                    سجّل التحويل
                  </Button>
                </div>
              </div>
            </Card>
          </section>
        )}
        <section aria-label="التحويلات السابقة" className="flex flex-col gap-3">
          <SectionHead title="التحويلات" description="الأحدث أولاً، بكلفة ما خرج من الفرع المرسِل." />
          <DataTable
            caption="التحويلات"
            columns={columns}
            rows={items ?? []}
            rowKey={(r) => r.id}
            loading={!items && !error}
            empty={
              <EmptyState
                icon={TransferIcon}
                title="لا تحويلات بعد."
                description="كل تحويل تسجّله يظهر هنا برقمه وكلفته."
              />
            }
          />
        </section>
      </div>
    </AppShell>
  );
}

/**
 * The sender and the receiver with the arrow between them. Screen readers (and the tests) read the
 * plain «من ← إلى» line; the drawn one is for the eye.
 */
function Route({ from, to }: { from: string; to: string }) {
  return (
    <span className="relative inline-flex items-center whitespace-nowrap">
      <span className="sr-only">{`${from} ← ${to}`}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-2">
        <span className="text-ink">{from}</span>
        <BackIcon size={16} className="rotate-180 text-ink-subtle" />
        <span className="font-semibold text-ink">{to}</span>
      </span>
    </span>
  );
}
