import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { COUNT_NOUNS, countNoun, type ExpiryResponse, type ExpiryRow } from '@serva/core';
import {
  Alert,
  Button,
  CalendarIcon,
  CheckCircleIcon,
  Dialog,
  formatQuantity,
  IconButton,
  Menu,
  MenuItem,
  MoreIcon,
  Skeleton,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { ReportScreen } from '../reports/parts';
import { SerialPick } from './SerialPick';
import { recallAnswer, rememberAnswer } from '../reports/useReport';
import { PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import {
  createStocktake,
  createSupplierReturn,
  listExpiry,
  newDocumentId,
  qtyOf,
  setBatchBlocked,
  storeToday,
} from './api';
import './inventory.css';

type Urgency = 'all' | 'expired' | 'week' | 'month';
type Action = { kind: 'writeoff' | 'count' | 'return'; row: ExpiryRow };

/** A refusal made on this page before anything is sent: its message is shown as written */
class Refused extends Error {}

const daysOf = (r: ExpiryRow) => r.daysLeft ?? Number.POSITIVE_INFINITY;

/** How soon a batch ends: gone, within the week, within the month (days from today). */
const IN_URGENCY: Record<Exclude<Urgency, 'all'>, (r: ExpiryRow) => boolean> = {
  expired: (r) => daysOf(r) < 0,
  week: (r) => daysOf(r) >= 0 && daysOf(r) <= 7,
  month: (r) => daysOf(r) >= 0 && daysOf(r) <= 30,
};

/** The «بلا دفعة» row: what no batch holds (it can run below zero), so the batches add up to the stock */
const isUnbatched = (r: ExpiryRow) => !r.batchNo && !r.expiryDate;

const rowKey = (r: ExpiryRow) => `${r.variantId}|${r.branchId}|${r.batchNo ?? ''}|${r.expiryDate ?? ''}`;

/** How many serial numbers an action takes out: the whole batch, the shortage a count finds, or the pieces sent back */
function pickPieces(action: Action, qtyText: string): number {
  if (!action.row.tracksSerial) return 0;
  const typed = qtyOf(qtyText);
  if (action.kind === 'writeoff') return Math.ceil(action.row.qty / 1000);
  if (typed === null) return 0;
  if (action.kind === 'count') return typed < action.row.qty ? Math.ceil((action.row.qty - typed) / 1000) : 0;
  return typed > 0 ? Math.ceil(typed / 1000) : 0;
}

const ACTION_TITLE: Record<Action['kind'], string> = {
  writeoff: 'أتلف الدفعة',
  count: 'عدّ الدفعة',
  return: 'أرجع للمورد',
};

/**
 * «الصلاحية» (03 › الصيدليات): the batches the store holds, with what is really left of each in
 * each branch (the batch ledger). An expired batch stays here until it is written off. Each batch
 * can be written off (through the count), counted, sent back to its supplier, or blocked so no till
 * sells it; «استدعاء دفعة» finds a batch by its number and everyone who got it.
 */
export function ExpiryPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const [days, setDays] = useState<'30' | '90' | '180' | '3650'>('3650');
  // The last answer stays on screen while the new one loads, so the page never opens blank
  const [data, setData] = useState<ExpiryResponse | null>(() => recallAnswer<ExpiryResponse>('expiry|3650'));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [urgency, setUrgency] = useState<Urgency>('all');
  const [action, setAction] = useState<Action | null>(null);
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState<ExpiryRow | null>(null);
  // A batch asked to be blocked: nothing is sent until it is confirmed
  const [blocking, setBlocking] = useState<ExpiryRow | null>(null);
  // One id for each opening of the action dialog: a second press posts nothing again
  const [docId, setDocId] = useState(newDocumentId);
  // A batch of a product that tracks serial numbers: which numbers leave (round 62); a write-off may leave them for later
  const [serials, setSerials] = useState<string[]>([]);

  const load = useCallback(() => {
    setError(null);
    const key = `expiry|${days}`;
    setData((now) => recallAnswer<ExpiryResponse>(key) ?? now);
    listExpiry(Number(days), days === '3650')
      .then((answer) => {
        rememberAnswer(key, answer);
        setData(answer);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [days]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(null);
  }, [printing]);

  const items = data?.items ?? [];
  const expired = items.filter(IN_URGENCY.expired);
  const week = items.filter(IN_URGENCY.week);
  const month = items.filter(IN_URGENCY.month);
  const shown = urgency === 'all' ? items : items.filter(IN_URGENCY[urgency]);

  function open(kind: Action['kind'], row: ExpiryRow) {
    setAction({ kind, row });
    setDocId(newDocumentId());
    setQty(kind === 'writeoff' ? '' : String(row.qty / 1000));
    setSerials([]);
    setError(null);
    setDone(null);
  }

  async function confirm() {
    if (!action) return;
    const { kind, row } = action;
    const typed = qtyOf(qty);
    const label = `${row.batchNo ?? ''} من «${row.name}»`;
    // How many numbers leave: the whole batch, the shortage a count finds, or the pieces sent back
    const leaving = pickPieces(action, qty);
    const later = leaving > 0 && serials.length === 0 && kind !== 'return';
    if (leaving > 0 && serials.length > 0 && serials.length !== leaving) {
      setError(
        `اختر ${leaving} رقماً تسلسلياً${kind === 'return' ? '' : '، أو اترك الاختيار كله وصحّحها لاحقاً'}.`,
      );
      return;
    }
    if (leaving > 0 && kind === 'return' && serials.length !== leaving) {
      setError(`اختر ${leaving} رقماً تسلسلياً، واحداً لكل قطعة.`);
      return;
    }
    const named = leaving > 0 && serials.length > 0 ? { serials } : {};
    const laterNote = later ? ' لم تُحدَّد أرقامها التسلسلية: صحّحها من صفحة «الأرقام التسلسلية».' : '';
    setSaving(true);
    setError(null);
    try {
      if (kind === 'writeoff') {
        // The existing write-off path: a count of this batch alone, down to nothing, noted «هدر»
        await createStocktake({
          id: docId,
          ...(row.tracksSerial && serials.length === 0 ? { serialsLater: true as const } : {}),
          branchId: row.branchId,
          date: storeToday(me.tenant.timezone),
          note: 'هدر',
          lines: [
            {
              variantId: row.variantId,
              countedQty: 0,
              batchNo: row.batchNo,
              expiryDate: row.expiryDate,
              ...named,
            },
          ],
        });
        setDone(`أُتلفت الدفعة ${label} وخرجت من المخزون.${laterNote}`);
      } else if (kind === 'count') {
        if (typed === null) throw new Refused('اكتب الكمية التي عددتها.');
        await createStocktake({
          id: docId,
          ...(row.tracksSerial && (serials.length === 0 || leaving === 0)
            ? { serialsLater: true as const }
            : {}),
          branchId: row.branchId,
          date: storeToday(me.tenant.timezone),
          lines: [
            {
              variantId: row.variantId,
              countedQty: typed,
              batchNo: row.batchNo,
              expiryDate: row.expiryDate,
              ...named,
            },
          ],
        });
        setDone(`سُجّل عدّ الدفعة ${label}.${laterNote}`);
      } else {
        if (!row.supplierId) {
          throw new Refused('لا مورد معروف لهذه الدفعة. سجّل المرتجع من صفحة «مرتجع إلى المورد».');
        }
        if (typed === null || typed <= 0) throw new Refused('اكتب كمية المرتجع.');
        await createSupplierReturn({
          id: docId,
          supplierId: row.supplierId,
          branchId: row.branchId,
          date: storeToday(me.tenant.timezone),
          refund: 'credit',
          note: `دفعة ${row.batchNo ?? ''}`,
          lines: [
            {
              variantId: row.variantId,
              qty: typed,
              batchNo: row.batchNo,
              expiryDate: row.expiryDate,
              ...named,
            },
          ],
        });
        setDone(`أُرجعت الدفعة ${label} إلى ${row.supplierName ?? 'المورد'}.`);
      }
      setAction(null);
      load();
    } catch (e) {
      setError(e instanceof Refused ? e.message : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBlock(row: ExpiryRow) {
    if (!row.batchNo) return;
    setError(null);
    setDone(null);
    try {
      await setBatchBlocked({ batchNo: row.batchNo, variantId: row.variantId }, !row.blocked);
      setDone(
        row.blocked
          ? `رُفع الإيقاف عن الدفعة ${row.batchNo}.`
          : `أُوقف بيع الدفعة ${row.batchNo} في كل الفروع.`,
      );
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /** Red only for what is gone or goes within the month; a batch with a long time left is a plain button */
  const rowActions = (r: ExpiryRow) => {
    if (isUnbatched(r)) return null;
    const urgent = r.daysLeft !== null && r.daysLeft <= 30;
    return (
      <span className="ix-acts print:hidden">
        {r.batchNo ? (
          <Link
            to={`/recall?batch=${encodeURIComponent(r.batchNo)}`}
            aria-label={`استدعاء الدفعة ${r.batchNo} من «${r.name}»`}
            className={`sx-fbtn${urgent ? ' ix-urgent' : ''}`}
          >
            استدعاء
          </Link>
        ) : null}
        <Menu
          label={`إجراءات دفعة «${r.name}»`}
          align="end"
          trigger={<IconButton size="sm" label={`إجراءات دفعة «${r.name}»`} icon={<MoreIcon />} />}
        >
          <MenuItem tone="danger" onSelect={() => open('writeoff', r)}>
            أتلف الدفعة
          </MenuItem>
          <MenuItem onSelect={() => open('count', r)}>عدّ</MenuItem>
          <MenuItem onSelect={() => open('return', r)}>أرجع للمورد</MenuItem>
          {r.batchNo ? (
            <MenuItem onSelect={() => (r.blocked ? void toggleBlock(r) : setBlocking(r))}>
              {r.blocked ? 'ارفع الإيقاف' : 'أوقف البيع'}
            </MenuItem>
          ) : null}
          <MenuItem onSelect={() => setPrinting(r)}>اطبع</MenuItem>
        </Menu>
      </span>
    );
  };

  const stateBadge = (r: ExpiryRow) =>
    isUnbatched(r) ? (
      <span className="ix-acts">
        <StatusPill kind="ok">بلا دفعة</StatusPill>
        {r.qty < 0 ? <StatusPill kind="danger">سالب</StatusPill> : null}
      </span>
    ) : (
      <span className="ix-acts">
        {r.daysLeft === null ? (
          <StatusPill kind="ok">بلا تاريخ</StatusPill>
        ) : r.daysLeft < 0 ? (
          <StatusPill kind="danger" icon={<CalendarIcon size={16} />}>
            منتهٍ منذ {countNoun(-r.daysLeft, COUNT_NOUNS.day, String(-r.daysLeft), true)}
          </StatusPill>
        ) : r.daysLeft <= 30 ? (
          <StatusPill kind="warn" icon={<CalendarIcon size={16} />}>
            باقٍ {countNoun(r.daysLeft, COUNT_NOUNS.day, String(r.daysLeft), true)}
          </StatusPill>
        ) : (
          <StatusPill kind="ok">
            باقٍ {countNoun(r.daysLeft, COUNT_NOUNS.day, String(r.daysLeft), true)}
          </StatusPill>
        )}
        {r.blocked ? <StatusPill kind="danger">موقوفة</StatusPill> : null}
      </span>
    );

  const columns: SxColumn<ExpiryRow>[] = [
    {
      key: 'name',
      header: 'الصنف',
      lead: true,
      cell: (r) => (
        <>
          {r.name}
          {/* On a phone the batch, its day and its branch ride under the name */}
          {r.batchNo || r.expiryDate ? (
            <span className="sx-subline sm:hidden">
              {r.batchNo ? (
                <bdi dir="ltr" className="sx-n">
                  {r.batchNo}
                </bdi>
              ) : null}
              {r.expiryDate ? <bdi className="sx-n"> · {dayText(r.expiryDate, digits)}</bdi> : null}
            </span>
          ) : null}
        </>
      ),
    },
    { key: 'left', header: 'الحالة', cell: (r) => stateBadge(r) },
    {
      key: 'expiry',
      header: 'تاريخ الانتهاء',
      cell: (r) =>
        r.expiryDate ? (
          <bdi className="sx-n">{dayText(r.expiryDate, digits)}</bdi>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    {
      key: 'batch',
      header: 'الدفعة',
      cell: (r) =>
        r.batchNo ? (
          <bdi dir="ltr" className="sx-n">
            {r.batchNo}
          </bdi>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    { key: 'branch', header: 'الفرع', hideBelowLg: true, cell: (r) => r.branchName },
    {
      key: 'qty',
      header: 'المتبقي',
      numeric: true,
      strong: true,
      cell: (r) => <bdi className="sx-n">{formatQuantity(r.qty, digits)}</bdi>,
    },
    {
      key: 'purchase',
      header: 'الاستلام',
      hideBelowLg: true,
      cell: (r) =>
        r.purchaseNumber ? (
          <>
            <bdi dir="ltr" className="sx-n">
              {r.purchaseNumber}
            </bdi>
            <span className="sx-subline">
              {r.supplierName} ·{' '}
              <span className="sx-n">{r.receivedOn ? dayText(r.receivedOn, digits) : '—'}</span>
            </span>
          </>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    { key: 'actions', header: 'إجراءات', cell: (r) => rowActions(r) },
  ];

  const nothingSoon = Boolean(data) && expired.length === 0 && week.length === 0 && month.length === 0;
  function pickUrgency(u: Urgency) {
    setUrgency(u);
    // «كل الدفعات» means all of them, whatever the window was narrowed to
    if (u === 'all') setDays('3650');
  }
  const chip = (key: Urgency, text: string, n: number | null) => (
    <label key={key} className="sx-chip">
      <input type="radio" name="expiry-urgency" checked={urgency === key} onChange={() => pickUrgency(key)} />
      {text}
      {n !== null ? <span className="sx-n sx-sub">{n}</span> : null}
    </label>
  );
  const WINDOWS: { value: '30' | '90' | '180' | '3650'; label: string }[] = [
    { value: '30', label: '30 يوماً' },
    { value: '90', label: '3 أشهر' },
    { value: '180', label: '6 أشهر' },
    { value: '3650', label: 'الكل' },
  ];
  const first = (list: ExpiryRow[]) => list[0]?.name;
  return (
    <ReportScreen me={me} access={['purchases.manage']} title="الصلاحية">
      <SalesPage>
        <PageTop
          title="الصلاحية"
          subtitle="الدفعات التي انتهت أو تقترب من نهايتها بكمياتها الحقيقية في كل فرع. المنتهية تبقى هنا حتى تُتلَف."
          actions={
            <Link to="/recall" className="sx-fbtn">
              استدعاء دفعة
            </Link>
          }
        />
        {error && !action ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        {!data ? (
          <Skeleton className="h-20 w-full" />
        ) : nothingSoon ? (
          <p className="sx-card ix-calm" role="status">
            <CheckCircleIcon size={20} />
            لا دفعات تنتهي قريباً: لا شيء منتهٍ ولا شيء خلال 30 يوماً.
          </p>
        ) : (
          <section aria-label="ما ينتهي" className="sx-card sx-strip ix-hero">
            <div>
              <span className="sx-eyebrow">منتهية</span>
              <span className={`v big sx-n${expired.length > 0 ? ' bad' : ''}`}>{expired.length}</span>
              <span className="note">{first(expired) ? `أقدمها: ${first(expired)}` : 'لا شيء منتهٍ'}</span>
            </div>
            <div>
              <span className="sx-eyebrow">تنتهي خلال 7 أيام</span>
              <span className={`v sx-n${week.length > 0 ? ' warn' : ''}`}>{week.length}</span>
              <span className="note">{first(week) ? `أقربها: ${first(week)}` : 'لا شيء هذا الأسبوع'}</span>
            </div>
            <div>
              <span className="sx-eyebrow">تنتهي خلال 30 يوماً</span>
              <span className="v sx-n">{month.length}</span>
              <span className="note">{first(month) ? `أقربها: ${first(month)}` : 'لا شيء هذا الشهر'}</span>
            </div>
          </section>
        )}
        <div className="sx-card sx-filterbar print:hidden">
          <div role="radiogroup" aria-label="اعرض" className="sx-chips scroll">
            {chip('all', 'كل الدفعات', null)}
            {chip('expired', 'منتهية', data ? expired.length : null)}
            {chip('week', 'هذا الأسبوع', data ? week.length : null)}
            {chip('month', 'هذا الشهر', data ? month.length : null)}
          </div>
          <span className="sx-eyebrow" aria-hidden="true">
            خلال
          </span>
          <div role="radiogroup" aria-label="خلال" className="sx-chips scroll">
            {WINDOWS.map((w) => (
              <label key={w.value} className="sx-chip">
                <input
                  type="radio"
                  name="expiry-window"
                  checked={days === w.value}
                  onChange={() => setDays(w.value)}
                />
                {w.label}
              </label>
            ))}
          </div>
        </div>
        {data && shown.length === 0 && !error ? (
          <section className="sx-card ix-empty" aria-label="الدفعات">
            <CalendarIcon size={32} />
            <h3>{items.length > 0 ? 'لا دفعات في هذه المجموعة.' : 'لا شيء ينتهي في هذه المدة.'}</h3>
            <p>
              {items.length > 0
                ? 'اختر «كل الدفعات» لترى الباقي.'
                : 'اكتب الدفعة وتاريخ الانتهاء في فاتورة الشراء ليظهر هنا.'}
            </p>
            {items.length === 0 ? (
              <Link to="/purchases" className="sx-fbtn">
                سجّل فاتورة شراء بتاريخ انتهاء
              </Link>
            ) : null}
          </section>
        ) : phone && shown.length > 0 ? (
          <ul aria-label="الدفعات حسب الصلاحية" className="sx-cards">
            {shown.map((r) => (
              <li key={rowKey(r)} className="ix-icard">
                <span className="n">{r.name}</span>
                <span className="v">{stateBadge(r)}</span>
                <span className="q">
                  <span>
                    المتبقي <bdi className="sx-n">{formatQuantity(r.qty, digits)}</bdi>
                  </span>
                  {r.expiryDate ? <span>· تنتهي {dayText(r.expiryDate, digits)}</span> : null}
                  {r.batchNo ? (
                    <span>
                      · دفعة{' '}
                      <bdi dir="ltr" className="sx-n">
                        {r.batchNo}
                      </bdi>
                    </span>
                  ) : null}
                  {r.branchName ? <span>· {r.branchName}</span> : null}
                </span>
                <span className="c">{rowActions(r)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <SxTable
            caption="الدفعات حسب الصلاحية"
            columns={columns}
            rows={shown}
            rowKey={rowKey}
            loading={!data && !error}
            error={error && !data ? error : undefined}
            onRetry={load}
          />
        )}
        {shown.some(isUnbatched) ? (
          <p className="sx-note tight">
            «بلا دفعة» هو ما لا تحمله أي دفعة (قد يكون سالباً بعد بيع بلا رقم دفعة)، فمجموع كل الصفوف يساوي
            المخزون.
          </p>
        ) : null}
      </SalesPage>
      {printing ? (
        <div className="hidden print:block" aria-hidden="true">
          <h1 className="text-lg font-bold">دفعة {printing.batchNo ?? ''}</h1>
          <p>{printing.name}</p>
          <p>الفرع: {printing.branchName}</p>
          <p>تنتهي: {printing.expiryDate ? dayText(printing.expiryDate, digits) : '—'}</p>
          <p>المتبقي: {formatQuantity(printing.qty, digits)}</p>
          <p>المورد: {printing.supplierName ?? '—'}</p>
        </div>
      ) : null}
      <Dialog
        open={blocking !== null}
        onOpenChange={(o) => !o && setBlocking(null)}
        title={`أوقف بيع الدفعة ${blocking?.batchNo ?? ''}`}
        description={blocking?.name}
        actions={
          <>
            <Button variant="secondary" onClick={() => setBlocking(null)}>
              تراجع
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const row = blocking;
                setBlocking(null);
                if (row) void toggleBlock(row);
              }}
            >
              أوقف البيع
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          لن يبيع أي صندوق في أي فرع هذه الدفعة حتى ترفع الإيقاف من هذه الصفحة. هل أنت متأكد؟
        </p>
      </Dialog>
      <Dialog
        open={action !== null}
        onOpenChange={(o) => !o && setAction(null)}
        title={action ? `${ACTION_TITLE[action.kind]} ${action.row.batchNo ?? ''}` : ''}
        description={action?.row.name}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>
              تراجع
            </Button>
            <Button
              variant={action?.kind === 'writeoff' ? 'danger' : 'primary'}
              loading={saving}
              onClick={() => void confirm()}
            >
              {action ? ACTION_TITLE[action.kind] : ''}
            </Button>
          </>
        }
      >
        {action?.kind === 'writeoff' ? (
          <p className="text-sm text-ink-muted">
            يخرج كل ما بقي من الدفعة ({formatQuantity(action.row.qty, digits)}) من المخزون كهدر، وتُسجَّل
            خسارته بكلفته.
          </p>
        ) : action ? (
          <TextField
            label={action.kind === 'count' ? 'الكمية التي عددتها' : 'الكمية الراجعة'}
            dir="ltr"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputClassName="num"
          />
        ) : null}
        {action?.row.tracksSerial && pickPieces(action, qty) > 0 ? (
          <div className="sx">
            <SerialPick
              name={action.row.name}
              variantId={action.row.variantId}
              branchId={action.row.branchId}
              pieces={pickPieces(action, qty)}
              picked={serials}
              onChange={setSerials}
              optional={action.kind !== 'return'}
            />
          </div>
        ) : null}
        {error && action ? <Alert tone="error">{error}</Alert> : null}
      </Dialog>
    </ReportScreen>
  );
}
