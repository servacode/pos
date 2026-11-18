import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  getCurrency,
  isCurrencyId,
  SETTLEMENT_STATUS_LABELS,
  type RepSettlementDetail,
  type SettlementPreview,
  type SettlementStatus,
} from '@serva/core';
import {
  Alert,
  BackIcon,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  Money,
  PageHeader,
  PrintIcon,
  Select,
  Skeleton,
  TextField,
  TruckIcon,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { PrintSheet, usePrint } from '../../lib/print';
import {
  approveSettlement,
  cancelSettlement,
  createSettlement,
  getSettlement,
  previewSettlement,
} from './api';
import { FormFooter, qtyOf, thousandths } from './parts';

export const SETTLEMENT_TONE: Record<SettlementStatus, BadgeTone> = {
  draft: 'warning',
  approved: 'success',
  cancelled: 'neutral',
};

export const SettlementBadge = ({ status }: { status: SettlementStatus }) => (
  <Badge tone={SETTLEMENT_TONE[status]}>{SETTLEMENT_STATUS_LABELS[status]}</Badge>
);

type Item = SettlementPreview['items'][number];

/** «12,500» typed in either digits → 1250000 (minor units of a currency with two decimals); null when it is not an amount */
export function minorOf(text: string, decimals: number): number | null {
  const clean = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '')
    .replace('٫', '.');
  if (clean === '' || !/^\d+(\.\d+)?$/.test(clean)) return null;
  return Math.round(Number(clean) * 10 ** decimals);
}

/** The treatment is a note only: it creates no debt, the shortage was booked as a cash difference when the shift closed */
const TREATMENT_LABELS = {
  rep_debt: 'سجّل النقص على المندوب (ملاحظة)',
  shop_loss: 'سجّل النقص خسارة على المحل (ملاحظة)',
} as const;

/** What a currency's drawer shows, line by line, in the order the money moved */
function CashCard({
  line,
  counted,
  onCounted,
  decimals,
}: {
  line: SettlementPreview['cash'][number];
  counted: string | null;
  onCounted: ((text: string) => void) | null;
  decimals: number;
}) {
  const cur = line.currency;
  const rows: [string, number, boolean?][] = [
    ['عهدة الافتتاح', line.openingMinor],
    ['مبيعات نقدية', line.cashSalesMinor],
    ['الباقي المدفوع للزبائن', -line.changeGivenMinor],
    ['مرتجعات مدفوعة', -line.refundsMinor],
    ['سندات قبض', line.receiptsMinor],
    ['إيداع بالدرج', line.payInMinor],
    ['مصروف من الدرج', -line.payOutMinor],
  ];
  const typed = counted === null ? null : minorOf(counted, decimals);
  const difference = typed === null ? null : typed - line.expectedMinor;
  return (
    <Card>
      <CardHeader title={`الصندوق بـ ${cur}`} />
      <dl className="flex flex-col gap-2 text-sm">
        {rows
          .filter(([, amount]) => amount !== 0)
          .map(([label, amount]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{label}</dt>
              <dd>
                <Money minor={amount} currency={cur} />
              </dd>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
          <dt>المطلوب أن يسلّمه</dt>
          <dd>
            <Money minor={line.expectedMinor} currency={cur} />
          </dd>
        </div>
        {line.dropsMinor > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">سلّمه فعلاً للخزنة</dt>
            <dd>
              <Money minor={line.dropsMinor} currency={cur} />
            </dd>
          </div>
        ) : null}
        {line.closingCountedMinor !== null ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">عدّه عند إغلاق ورديته</dt>
            <dd>
              <Money minor={line.closingCountedMinor} currency={cur} />
            </dd>
          </div>
        ) : null}
      </dl>
      {onCounted ? (
        <div className="mt-4 flex flex-col gap-2">
          <TextField
            label={`ما عددته منه بـ ${cur}`}
            inputMode="decimal"
            dir="ltr"
            value={counted ?? ''}
            onChange={(e) => onCounted(e.target.value.slice(0, 15))}
            inputClassName="num"
          />
          {difference !== null && difference !== 0 ? (
            <Alert tone={difference < 0 ? 'error' : 'warning'}>
              {difference < 0 ? 'ناقص ' : 'زائد '}
              <Money minor={Math.abs(difference)} currency={cur} />
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Totals({ preview }: { preview: SettlementPreview }) {
  const base = preview.baseCurrency;
  const s = preview.sales;
  return (
    <Card>
      <CardHeader title="حصيلة اليوم" />
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">فواتير البيع</dt>
          <dd>
            <bdi className="num">{s.count}</bdi> · <Money minor={s.totalMinor} currency={base} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">المرتجع</dt>
          <dd>
            <bdi className="num">{s.returnsCount}</bdi> ·{' '}
            <Money minor={s.returnsTotalMinor} currency={base} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">سندات القبض</dt>
          <dd>
            <bdi className="num">{s.receiptsCount}</bdi>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">الزيارات</dt>
          <dd>
            <bdi className="num">{s.visits}</bdi>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** The figures the settlement compares, the same on the new page, on the saved one and on paper */
function Review({
  preview,
  counted,
  onCounted,
  decimalsOf,
}: {
  preview: SettlementPreview;
  counted: Record<string, string> | null;
  onCounted: ((currency: string, text: string) => void) | null;
  decimalsOf: (currency: string) => number;
}) {
  return (
    <div className="flex flex-col gap-4">
      {preview.cash.length > 0 && onCounted ? (
        <Alert tone="info">
          إيداع النقد للخزنة من جوال المندوب يحتاج موافقة مدير برمز من 6 أرقام وصلاحية حركة الصندوق. يوافق
          المالك أو المدير الذي له رمز. لإضافة رمز: الموظفون، افتح المستخدم، ثم رمز الدخول (6 أرقام).
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {preview.cash.length === 0 ? (
          <Alert tone="info">لا وردية لهذا المندوب في هذا اليوم: لا صندوق للمقارنة.</Alert>
        ) : (
          preview.cash.map((line) => (
            <CashCard
              key={line.currency}
              line={line}
              decimals={decimalsOf(line.currency)}
              counted={counted ? (counted[line.currency] ?? '') : null}
              onCounted={onCounted ? (text) => onCounted(line.currency, text) : null}
            />
          ))
        )}
        <Totals preview={preview} />
      </div>
    </div>
  );
}

function ItemsTable({
  items,
  typed,
  onTyped,
}: {
  items: readonly Item[];
  typed: Record<string, string> | null;
  onTyped: ((variantId: string, text: string) => void) | null;
}) {
  const columns: DataColumn<Item>[] = [
    { key: 'name', header: 'الصنف', cell: (i) => <span className="font-semibold">{i.name}</span> },
    { key: 'book', header: 'في الدفتر', numeric: true, cell: (i) => qtyOf(i.expectedQty) },
    {
      key: 'counted',
      header: 'المعدود',
      numeric: true,
      cell: (i) => {
        const own = typed?.[i.variantId];
        if (onTyped && typed) {
          return (
            <div className="w-20 ms-auto">
              <TextField
                label={`عدّ ${i.name}`}
                hideLabel
                inputMode="decimal"
                dir="ltr"
                value={own ?? (i.countedQty === null ? '' : qtyOf(i.countedQty))}
                onChange={(e) => onTyped(i.variantId, e.target.value.slice(0, 9))}
                inputClassName="num"
              />
            </div>
          );
        }
        return i.countedQty === null ? '—' : qtyOf(i.countedQty);
      },
    },
    {
      key: 'diff',
      header: 'الفرق',
      numeric: true,
      cell: (i) => {
        const own = typed?.[i.variantId];
        const counted =
          own !== undefined ? (thousandths(own) ?? (own.trim() === '0' ? 0 : null)) : i.countedQty;
        if (counted === null) return '—';
        const diff = counted - i.expectedQty;
        return diff === 0 ? (
          <Badge tone="success">مطابق</Badge>
        ) : (
          <Badge tone={diff < 0 ? 'danger' : 'warning'}>
            {diff < 0 ? 'ناقص ' : 'زائد '}
            <span className="num">{qtyOf(Math.abs(diff))}</span>
          </Badge>
        );
      },
    },
  ];
  return (
    <DataTable
      caption="جرد السيارة"
      columns={columns}
      rows={items}
      rowKey={(i) => i.variantId}
      empty={<p className="py-4 text-center text-sm text-ink-muted">لا أصناف في السيارة.</p>}
    />
  );
}

/** The sheet the supervisor signs with the rep: cash, cheques and the van, in one page */
export function SettlementSheet({ detail }: { detail: RepSettlementDetail }) {
  const cell = { border: '1px solid #000', padding: '4pt', textAlign: 'start' } as const;
  const p = detail.preview;
  return (
    <div dir="rtl" className="text-ink" style={{ fontSize: '11pt' }}>
      <h1 style={{ fontSize: '16pt', fontWeight: 700 }}>تسوية مندوب {detail.number}</h1>
      <p style={{ marginBottom: '8pt' }}>
        {detail.repName} · {p.vanName ?? 'بلا سيارة'} · {detail.businessDate} ·{' '}
        {SETTLEMENT_STATUS_LABELS[detail.status]}
      </p>
      <table className="w-full border-collapse" style={{ marginBottom: '8pt' }}>
        <thead>
          <tr>
            {['العملة', 'المطلوب', 'المعدود', 'الفرق'].map((h) => (
              <th key={h} style={cell}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys({ ...detail.expectedCash, ...detail.countedCash }).map((cur) => (
            <tr key={cur}>
              <td style={cell}>{cur}</td>
              <td style={cell}>
                <Money minor={detail.expectedCash[cur] ?? 0} currency={cur as never} />
              </td>
              <td style={cell}>
                <Money minor={detail.countedCash[cur] ?? 0} currency={cur as never} />
              </td>
              <td style={cell}>
                <Money minor={detail.cashDifference[cur] ?? 0} currency={cur as never} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.treatment ? <p>المعالجة: {TREATMENT_LABELS[detail.treatment]}</p> : null}
      {p.cheques.length > 0 ? (
        <>
          <h2 style={{ fontSize: '12pt', fontWeight: 700, marginTop: '8pt' }}>الشيكات</h2>
          <table className="w-full border-collapse">
            <tbody>
              {p.cheques.map((c) => (
                <tr key={c.sourceId + c.number}>
                  <td style={cell}>{c.number}</td>
                  <td style={cell}>{c.customerName ?? '—'}</td>
                  <td style={cell}>
                    <Money minor={c.amountMinor} currency={c.currency} />
                  </td>
                  <td style={cell}>
                    {detail.cheques.received.includes(c.sourceId) ? 'استُلم' : 'لم يُستلم'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {detail.goods.lines.length > 0 ? (
        <>
          <h2 style={{ fontSize: '12pt', fontWeight: 700, marginTop: '8pt' }}>جرد السيارة</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['الصنف', 'الدفتر', 'المعدود'].map((h) => (
                  <th key={h} style={cell}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.goods.lines.map((i) => (
                <tr key={i.variantId}>
                  <td style={cell}>{i.name}</td>
                  <td style={cell}>{qtyOf(i.expectedQty)}</td>
                  <td style={cell}>{i.countedQty === null ? '—' : qtyOf(i.countedQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {detail.note ? <p style={{ marginTop: '8pt' }}>ملاحظة: {detail.note}</p> : null}
      <p style={{ marginTop: '24pt' }}>توقيع المندوب: ____________ توقيع المشرف: ____________</p>
    </div>
  );
}

const currencyDecimals = (currency: string) => (isCurrencyId(currency) ? getCurrency(currency).decimals : 2);

/** «تسوية جديدة»: what the rep’s day produced, beside what the supervisor counts from him */
export function NewSettlementPage() {
  const [params] = useSearchParams();
  const repId = params.get('repId') ?? '';
  const date = params.get('date') ?? '';
  const navigate = useNavigate();
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [received, setReceived] = useState<string[]>([]);
  const [treatment, setTreatment] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    previewSettlement(repId, date)
      .then((p) => {
        setPreview(p);
        // What the rep already handed in and what is still in his drawer is what the supervisor expects to hold
        setCounted(
          Object.fromEntries(
            p.cash.map((c) => [
              c.currency,
              String((c.dropsMinor + (c.closingCountedMinor ?? 0)) / 10 ** currencyDecimals(c.currency)),
            ]),
          ),
        );
        setReceived(p.cheques.map((c) => c.sourceId));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [repId, date]);

  const short = useMemo(
    () =>
      (preview?.cash ?? []).some((c) => {
        const typedMinor = minorOf(counted[c.currency] ?? '', currencyDecimals(c.currency));
        return typedMinor !== null && typedMinor < c.expectedMinor;
      }),
    [preview, counted],
  );

  if (!preview) return error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-40 w-full" />;

  async function save() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const countedCash: Record<string, number> = {};
      for (const c of preview.cash) {
        const value = minorOf(counted[c.currency] ?? '', currencyDecimals(c.currency));
        if (value === null) {
          setError(`اكتب المبلغ الذي عددته بـ ${c.currency}.`);
          setSaving(false);
          return;
        }
        countedCash[c.currency] = value;
      }
      const own = Object.keys(typed).length > 0;
      const made = await createSettlement({
        repId,
        businessDate: date,
        countedCash,
        treatment: treatment === '' ? null : (treatment as 'rep_debt' | 'shop_loss'),
        note: note.trim() === '' ? null : note,
        receivedCheques: received,
        ...(own
          ? {
              vanCount: preview.items.flatMap((i) => {
                const text = typed[i.variantId];
                const value =
                  text !== undefined ? (thousandths(text) ?? (text.trim() === '0' ? 0 : null)) : i.countedQty;
                return value === null ? [] : [{ variantId: i.variantId, countedQty: value }];
              }),
            }
          : {}),
      });
      void navigate(`/distribution/settlements/${made.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? errorMessage(e) : errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`تسوية ${preview.repName}`}
        description={
          <>
            {preview.vanName ?? 'بلا سيارة'} · <bdi className="num">{preview.businessDate}</bdi>
          </>
        }
        icon={<TruckIcon />}
        actions={
          <Link to="/distribution/settlements">
            <Button variant="secondary" icon={<BackIcon />}>
              كل التسويات
            </Button>
          </Link>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {preview.existing ? (
        <Alert tone="warning">
          لهذا اليوم تسوية{' '}
          <Link className="font-semibold underline" to={`/distribution/settlements/${preview.existing.id}`}>
            <bdi className="num">{preview.existing.number}</bdi>
          </Link>
          . ألغِ المسودة أولاً إن أردت غيرها.
        </Alert>
      ) : null}
      {preview.pendingDocs > 0 ? (
        <Alert tone="warning">
          على جوال المندوب <bdi className="num">{preview.pendingDocs}</bdi> مستنداً لم يصل بعد. انتظر وصولها
          قبل أن تحسم المبالغ.
        </Alert>
      ) : null}
      {preview.shifts.some((s) => s.status === 'open') ? (
        <Alert tone="warning">لم يُغلق المندوب ورديته بعد، فأرقام الصندوق غير نهائية.</Alert>
      ) : null}
      <Review
        preview={preview}
        counted={counted}
        onCounted={(currency, text) => setCounted((c) => ({ ...c, [currency]: text }))}
        decimalsOf={currencyDecimals}
      />
      {preview.cheques.length > 0 ? (
        <Card>
          <CardHeader title="الشيكات التي أخذها" />
          <ul className="flex flex-col divide-y divide-line">
            {preview.cheques.map((c) => (
              <li key={c.sourceId + c.number} className="flex items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`استلمت الشيك ${c.number}`}
                  checked={received.includes(c.sourceId)}
                  onChange={(e) =>
                    setReceived((r) =>
                      e.target.checked ? [...r, c.sourceId] : r.filter((x) => x !== c.sourceId),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate">
                  <bdi className="num">{c.number}</bdi> · {c.customerName ?? '—'}
                  {c.dueDate ? (
                    <>
                      {' '}
                      · يستحق <bdi className="num">{c.dueDate}</bdi>
                    </>
                  ) : null}
                </span>
                <Money minor={c.amountMinor} currency={c.currency} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <section aria-label="جرد السيارة" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">جرد السيارة</h2>
        {preview.vanCountAt === null ? (
          <Alert tone="info">
            لم يرسل المندوب جرد سيارته. اكتب العدد بنفسك، أو احفظ التسوية بلا جرد فلا يتحرك المخزون.
          </Alert>
        ) : null}
        <ItemsTable
          items={preview.items}
          typed={typed}
          onTyped={(variantId, text) => setTyped((t) => ({ ...t, [variantId]: text }))}
        />
      </section>
      <Card>
        <CardHeader title="المعالجة" />
        <div className="flex flex-col gap-4">
          {short ? (
            <Select label="النقص يصير" value={treatment} onChange={(e) => setTreatment(e.target.value)}>
              <option value="">لم أقرر بعد</option>
              <option value="rep_debt">{TREATMENT_LABELS.rep_debt}</option>
              <option value="shop_loss">{TREATMENT_LABELS.shop_loss}</option>
            </Select>
          ) : null}
          {short ? (
            <p className="text-xs text-ink-muted">
              هذا الاختيار ملاحظة فقط، لا ينشئ ذمة ولا قيداً. النقص سُجّل كفرق صندوق عند إغلاق الوردية.
            </p>
          ) : null}
          <TextField label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
          <p className="text-xs text-ink-muted">
            التسوية سجل فقط: لا تُرحِّل قيداً. الاعتماد يجرد السيارة ويفرّغ ما فيها إلى مخزن الفرع.
          </p>
          <FormFooter>
            <Button loading={saving} disabled={!!preview.existing} onClick={() => void save()}>
              احفظ التسوية مسودة
            </Button>
          </FormFooter>
        </div>
      </Card>
    </>
  );
}

function ApproveDialog({
  detail,
  onDone,
  onRefresh,
  onCancel,
}: {
  detail: RepSettlementDetail;
  onDone: (d: RepSettlementDetail) => void;
  onRefresh: (d: RepSettlementDetail) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const moves = detail.goods.counted && detail.goods.lines.some((l) => l.countedQty !== null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`اعتماد التسوية ${detail.number}`}
      description={
        moves
          ? 'يُجرد مخزون السيارة على ما عُدّ، ثم يُحوَّل ما فيها إلى مخزن الفرع.'
          : 'لا جرد لهذه التسوية: يُسجَّل الاعتماد فقط ولا يتحرك المخزون.'
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            تراجع
          </Button>
          <Button
            loading={saving}
            onClick={() => {
              setSaving(true);
              approveSettlement(detail.id, detail.version)
                .then(onDone)
                .catch((e: unknown) => {
                  setError(errorMessage(e));
                  setSaving(false);
                  // A refused approval moves the record on: read it again so the next try is of the current one
                  getSettlement(detail.id)
                    .then(onRefresh)
                    .catch(() => undefined);
                });
            }}
          >
            اعتمد
          </Button>
        </FormFooter>
      </div>
    </Dialog>
  );
}

function CancelDialog({
  detail,
  onDone,
  onCancel,
}: {
  detail: RepSettlementDetail;
  onDone: (d: RepSettlementDetail) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`إلغاء التسوية ${detail.number}`}
      description="تبقى مسجلة ملغاة، ويمكنك إنشاء غيرها لليوم نفسه."
    >
      <form
        aria-label="إلغاء التسوية"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          cancelSettlement(detail.id, detail.version, reason)
            .then(onDone)
            .catch((err: unknown) => {
              setError(errorMessage(err));
              setSaving(false);
            });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField label="سبب الإلغاء" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        <FormFooter>
          <Button variant="secondary" onClick={onCancel}>
            تراجع
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            ألغِ التسوية
          </Button>
        </FormFooter>
      </form>
    </Dialog>
  );
}

/** One saved settlement: what it saw, what was counted, and the supervisor's moves: approve, cancel, print */
export function SettlementPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<RepSettlementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'approve' | 'cancel' | null>(null);
  const { paper, print } = usePrint();

  useEffect(() => {
    getSettlement(id)
      .then(setDetail)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  if (!detail) return error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-40 w-full" />;
  const p = detail.preview;
  return (
    <>
      <PageHeader
        title={`التسوية ${detail.number}`}
        description={
          <>
            {detail.repName} · {p.vanName ?? 'بلا سيارة'} · <bdi className="num">{detail.businessDate}</bdi>
          </>
        }
        icon={<TruckIcon />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SettlementBadge status={detail.status} />
            <Link to="/distribution/settlements">
              <Button variant="secondary" icon={<BackIcon />}>
                كل التسويات
              </Button>
            </Link>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
              اطبع
            </Button>
          </div>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {detail.pendingDocs > 0 ? (
        <Alert tone="warning">
          عند إنشائها كان على جوال المندوب <bdi className="num">{detail.pendingDocs}</bdi> مستنداً لم يصل.
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {Object.keys({ ...detail.expectedCash, ...detail.countedCash }).map((cur) => {
          const diff = detail.cashDifference[cur] ?? 0;
          return (
            <Card key={cur}>
              <CardHeader title={`الصندوق بـ ${cur}`} />
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">المطلوب</dt>
                  <dd>
                    <Money minor={detail.expectedCash[cur] ?? 0} currency={cur as never} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">المعدود</dt>
                  <dd>
                    <Money minor={detail.countedCash[cur] ?? 0} currency={cur as never} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
                  <dt>الفرق</dt>
                  <dd>
                    {diff === 0 ? (
                      <Badge tone="success">مطابق</Badge>
                    ) : (
                      <Badge tone={diff < 0 ? 'danger' : 'warning'}>
                        {diff < 0 ? 'ناقص ' : 'زائد '}
                        <Money minor={Math.abs(diff)} currency={cur as never} />
                      </Badge>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
          );
        })}
        <Totals preview={p} />
        <Card>
          <CardHeader title="التفاصيل" />
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">المعالجة</dt>
              <dd>{detail.treatment ? TREATMENT_LABELS[detail.treatment] : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">أنشأها</dt>
              <dd>{detail.createdByName ?? '—'}</dd>
            </div>
            {detail.approvedAt ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">اعتمدها</dt>
                <dd>{detail.approvedByName ?? '—'}</dd>
              </div>
            ) : null}
            {detail.goods.stocktakeNumber ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">جرد السيارة</dt>
                <dd>
                  <bdi className="num">{detail.goods.stocktakeNumber}</bdi>
                </dd>
              </div>
            ) : null}
            {detail.goods.transferNumber ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">تفريغ السيارة</dt>
                <dd>
                  <bdi className="num">{detail.goods.transferNumber}</bdi>
                </dd>
              </div>
            ) : null}
            {detail.note ? <p className="rounded-control bg-surface-muted p-3">{detail.note}</p> : null}
          </dl>
        </Card>
      </div>
      {p.cheques.length > 0 ? (
        <Card>
          <CardHeader title="الشيكات" />
          <ul className="flex flex-col divide-y divide-line">
            {p.cheques.map((c) => (
              <li key={c.sourceId + c.number} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <bdi className="num">{c.number}</bdi> · {c.customerName ?? '—'}
                </span>
                <Badge tone={detail.cheques.received.includes(c.sourceId) ? 'success' : 'warning'}>
                  {detail.cheques.received.includes(c.sourceId) ? 'استُلم' : 'لم يُستلم'}
                </Badge>
                <Money minor={c.amountMinor} currency={c.currency} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {detail.goods.lines.length > 0 ? (
        <section aria-label="جرد السيارة" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">جرد السيارة</h2>
          <ItemsTable items={detail.goods.lines} typed={null} onTyped={null} />
        </section>
      ) : null}
      {detail.status === 'draft' ? (
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setDialog('cancel')}>
            ألغِ المسودة
          </Button>
          <Button onClick={() => setDialog('approve')}>اعتمد التسوية</Button>
        </div>
      ) : null}
      {dialog === 'approve' ? (
        <ApproveDialog
          detail={detail}
          onRefresh={setDetail}
          onCancel={() => setDialog(null)}
          onDone={(d) => {
            setDetail(d);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog
          detail={detail}
          onCancel={() => setDialog(null)}
          onDone={(d) => {
            setDetail(d);
            setDialog(null);
          }}
        />
      ) : null}
      {paper ? (
        <PrintSheet paper={paper}>
          <SettlementSheet detail={detail} />
        </PrintSheet>
      ) : null}
    </>
  );
}
