import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  getCurrency,
  type CurrencyCode,
  type PaymentMethod,
  type SaleListItem,
  type SaleStatus,
  type SaleSummary,
} from '@serva/core';
import {
  Alert,
  Button,
  CalendarIcon,
  CloseIcon,
  EmptyState,
  SalesIcon,
  SearchField,
  Select,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { dayText, isoDay, monthStart, zonedClock } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { BranchSelect, defaultBranch, ReportScreen } from '../reports/parts';
import { PERIOD_KEYS, PERIOD_LABELS, periodOf, periodRange } from '../reports/periods';
import { Pager, useCursorPages } from '../pager';
import { getSalesSummary, listSales, type SaleFilters } from './api';
import { salesCsv } from './csv';
import { downloadText } from '../accounting/csv';
import { InvoiceSheet } from './InvoiceSheet';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';
import {
  Amt,
  ChevDown,
  DownloadGlyph,
  FilterGlyph,
  invoicesNoun,
  PageTop,
  rangeText,
  SalesPage,
  SaleStatusBadge,
  SxTable,
  weekdayName,
  type SxColumn,
} from './ui';

/** The server's check is report.view alone (reports.financial does not open the invoice list). */
export const INVOICES_ACCESS = ['report.view'] as const;

/**
 * A CSV is read page by page, 200 invoices at a time, up to this many pages (100,000 invoices):
 * past that the user is told how many went in and to narrow the range.
 */
const CSV_MAX_PAGES = 500;
const CSV_PAGE = 200;
/** The longest search the server takes (contracts/sales.ts) */
const SEARCH_MAX = 60;
const PAGE_SIZE = 50;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayParam = (value: string | null, fallback: string) =>
  value && ISO_DAY.test(value) ? value : fallback;

/** What the server's field names mean on this screen, in the words of its fields. */
const SERVER_FIELD_TEXT: Record<string, string> = {
  q: 'البحث غير مقبول. اختصره وجرّب مرة ثانية.',
  minTotal: 'أقل مبلغ غير مقبول.',
  maxTotal: 'أكثر مبلغ يجب ألا يقل عن أقل مبلغ.',
  from: 'تاريخ البداية غير صحيح.',
  to: 'تاريخ النهاية غير صحيح.',
};

const EMPTY_PAGE = { items: [] as SaleListItem[], nextCursor: null };

/** «1250.5» in an invoice's currency → «125050» minor units; null for anything else. */
export function toMinor(text: string, currency: CurrencyCode): string | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const { decimals } = getCurrency(currency);
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) return null;
  return String(Number(`${whole}${fraction.padEnd(decimals, '0')}`));
}

/**
 * «الفواتير»: every sale of the store, found by its number, its customer, its day, its payment or
 * its amount; each opens as it was printed, to print again or to export the list as CSV.
 */
export function InvoicesPage() {
  const me = useMe();
  const digits = useDigits();
  // The filters and the page live in the address, so a reload or «back» finds the list as it was left
  const [params, setParams] = useSearchParams();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const base = me.settings.baseCurrency;
  const customerId = params.get('customerId');
  const numberQuery = params.get('q') ?? '';
  const [from, setFrom] = useState(() =>
    dayParam(params.get('from'), customerId || numberQuery ? '2020-01-01' : monthStart(today)),
  );
  const [to, setTo] = useState(() => dayParam(params.get('to'), today));
  const [branchId, setBranchId] = useState<string | null>(() => {
    const asked = params.get('branch');
    return asked === 'all' ? null : asked || defaultBranch(me);
  });
  const [method, setMethod] = useState(() => params.get('method') ?? '');
  const [status, setStatus] = useState(() => params.get('status') ?? '');
  const [deviceId, setDeviceId] = useState(() => params.get('device') ?? '');
  const [cashierId, setCashierId] = useState(() => params.get('cashier') ?? '');
  const [typed, setTyped] = useState(numberQuery);
  const [q, setQ] = useState(numberQuery);
  const [min, setMin] = useState(() => params.get('min') ?? '');
  const [max, setMax] = useState(() => params.get('max') ?? '');
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  // What the server refused, by field, for the last list asked
  const [refused, setRefused] = useState<Record<string, string> | null>(null);
  // The cursors of the pages passed, and the filters they belong to (a cursor of other filters is no use)
  const [pg, setPg] = useState<{ key: string | null; cursors: string[] }>(() => ({
    key: null,
    cursors: (params.get('pg') ?? '').split('.').filter(Boolean).slice(0, 200),
  }));

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const minMinor = toMinor(min, base);
  const maxMinor = toMinor(max, base);
  // Said on the field before anything is sent
  const searchError =
    typed.trim().length > SEARCH_MAX ? `البحث أطول من ${SEARCH_MAX} حرفاً. اختصره.` : undefined;
  const minError = min && minMinor === null ? 'اكتب رقماً' : undefined;
  const maxError =
    max && maxMinor === null
      ? 'اكتب رقماً'
      : minMinor !== null && maxMinor !== null && min && max && Number(minMinor) > Number(maxMinor)
        ? 'أكثر مبلغ أقل من أقل مبلغ'
        : undefined;
  const invalid = Boolean(searchError || minError || maxError);

  const filters: SaleFilters = useMemo(
    () => ({
      from,
      to,
      branchId,
      deviceId: deviceId || null,
      cashierId: cashierId || null,
      customerId,
      method: method || null,
      status: status || null,
      q,
      minTotal: minMinor ?? '',
      maxTotal: maxMinor ?? '',
    }),
    [from, to, branchId, deviceId, cashierId, customerId, method, status, q, minMinor, maxMinor],
  );
  const fetchKey = JSON.stringify([filters, invalid]);
  const firstKey = useRef(fetchKey);
  const {
    data: page,
    error,
    loading,
    retry,
    topRef,
    pager,
  } = useCursorPages(
    fetchKey,
    async (cursor) => {
      setRefused(null);
      // A search, an amount or a range the server would refuse is not sent: the fields say why
      if (invalid) return EMPTY_PAGE;
      try {
        return await listSales(filters, cursor, PAGE_SIZE);
      } catch (e) {
        if (e instanceof ApiError && e.fields && Object.keys(e.fields).length > 0) setRefused(e.fields);
        throw e;
      }
    },
    {
      initial: pg.cursors,
      pageSize: PAGE_SIZE,
      onCursors: (cursors) => setPg({ key: fetchKey, cursors }),
    },
  );
  const items = useMemo(() => page?.items ?? [], [page]);

  // The strip above the list: the same filters, one request, the newest answer only
  const [summary, setSummary] = useState<{ key: string; data: SaleSummary | null }>({
    key: '',
    data: null,
  });
  useEffect(() => {
    if (invalid) return;
    let current = true;
    getSalesSummary(filters).then(
      (data) => current && setSummary({ key: fetchKey, data }),
      () => current && setSummary({ key: fetchKey, data: null }),
    );
    return () => {
      current = false;
    };
  }, [fetchKey, filters, invalid]);

  // Keep the address in step with the filters and the page
  useEffect(() => {
    const next = new URLSearchParams();
    if (customerId) next.set('customerId', customerId);
    if (q) next.set('q', q);
    if (from !== monthStart(today)) next.set('from', from);
    if (to !== today) next.set('to', to);
    if (branchId !== defaultBranch(me)) next.set('branch', branchId ?? 'all');
    if (method) next.set('method', method);
    if (status) next.set('status', status);
    if (deviceId) next.set('device', deviceId);
    if (cashierId) next.set('cashier', cashierId);
    if (min) next.set('min', min);
    if (max) next.set('max', max);
    const mine = pg.key === fetchKey || (pg.key === null && fetchKey === firstKey.current);
    if (mine && pg.cursors.length > 0) next.set('pg', pg.cursors.join('.'));
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [
    customerId,
    q,
    from,
    to,
    today,
    branchId,
    me,
    method,
    status,
    deviceId,
    cashierId,
    min,
    max,
    pg,
    fetchKey,
    params,
    setParams,
  ]);

  // The cashiers and devices to pick from are the ones seen in the rows loaded so far
  const [seen, setSeen] = useState<{ cashiers: Map<string, string>; devices: Map<string, string> }>({
    cashiers: new Map(),
    devices: new Map(),
  });
  useEffect(() => {
    if (items.length === 0) return;
    setSeen((s) => {
      const cashiers = new Map(s.cashiers);
      const devices = new Map(s.devices);
      for (const item of items) {
        cashiers.set(item.cashier.id, item.cashier.fullName ?? '—');
        devices.set(item.deviceId, item.deviceCode ?? '—');
      }
      return { cashiers, devices };
    });
  }, [items]);

  const tz = me.tenant.timezone;

  async function exportCsv() {
    setExporting(true);
    setExportCount(0);
    setExportError(null);
    setExportNote(null);
    try {
      const all: SaleListItem[] = [];
      let next: string | null = null;
      for (let pages = 0; pages < CSV_MAX_PAGES; pages += 1) {
        const chunk: Awaited<ReturnType<typeof listSales>> = await listSales(filters, next, CSV_PAGE);
        all.push(...chunk.items);
        setExportCount(all.length);
        next = chunk.nextCursor;
        if (!next) break;
      }
      downloadText(`الفواتير-${from}-${to}.csv`, salesCsv(all, tz));
      const count = all.length.toLocaleString('en-US');
      setExportNote(
        next
          ? {
              tone: 'warning',
              text: `الملف فيه أحدث ${count} فاتورة فقط، وفي المدة فواتير أكثر. ضيّق المدة (مثلاً شهراً شهراً) أو اختر فرعاً واحداً لتصدّر الباقي.`,
            }
          : { tone: 'success', text: `صُدّرت ${count} فاتورة كلها.` },
      );
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const phone = useIsPhone();
  const branchLabel = (id: string) => me.branches.find((b) => b.id === id)?.name ?? 'الفرع';
  const defaultBranchId = defaultBranch(me);
  const multiBranch = me.branches.length > 1;

  // The filters beyond the search and the days, each one a removable chip
  const active: { key: string; label: string; clear: () => void }[] = [];
  if (branchId !== defaultBranchId)
    active.push({
      key: 'branch',
      label: `الفرع: ${branchId ? branchLabel(branchId) : 'كل الفروع'}`,
      clear: () => setBranchId(defaultBranchId),
    });
  if (method)
    active.push({
      key: 'method',
      label: `الدفع: ${METHOD_TEXT[method as PaymentMethod] ?? method}`,
      clear: () => setMethod(''),
    });
  if (status)
    active.push({
      key: 'status',
      label: `الحالة: ${SALE_STATUS_TEXT[status as SaleStatus] ?? status}`,
      clear: () => setStatus(''),
    });
  if (cashierId)
    active.push({
      key: 'cashier',
      label: `الكاشير: ${seen.cashiers.get(cashierId) ?? '—'}`,
      clear: () => setCashierId(''),
    });
  if (deviceId)
    active.push({
      key: 'device',
      label: `الجهاز: ${seen.devices.get(deviceId) ?? '—'}`,
      clear: () => setDeviceId(''),
    });
  if (min) active.push({ key: 'min', label: `من ${min}`, clear: () => setMin('') });
  if (max) active.push({ key: 'max', label: `حتى ${max}`, clear: () => setMax('') });
  const clearAll = () => {
    setBranchId(defaultBranchId);
    setMethod('');
    setStatus('');
    setCashierId('');
    setDeviceId('');
    setMin('');
    setMax('');
  };

  // The two popovers of the bar (the days, the filters); on a phone they are bottom sheets
  const [pop, setPop] = useState<'date' | 'filter' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fieldProblem = Boolean(minError || maxError || refused?.minTotal || refused?.maxTotal);
  const shown = fieldProblem ? 'filter' : pop;
  useEffect(() => {
    if (!pop) return;
    const away = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setPop(null);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPop(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [pop]);
  const found =
    summary.key === fetchKey && summary.data ? summary.data.totals.reduce((n, t) => n + t.count, 0) : null;

  // Day by day: an invoice list is read by its days
  const dayGroup = (row: SaleListItem) => row.businessDate;
  const dayLabel = (day: string, count: number) => (
    <>
      {dayText(day, digits)}
      <span>
        {weekdayName(day)} · {invoicesNoun(count)}
      </span>
    </>
  );

  const columns: SxColumn<SaleListItem>[] = [
    {
      key: 'number',
      header: 'الفاتورة',
      lead: true,
      cell: (row) => (
        <>
          <button type="button" onClick={() => setOpenId(row.id)} className="sx-rowbtn">
            <bdi className="sx-n sx-no" dir="ltr">
              {row.number}
            </bdi>
          </button>
          <span className="sx-subline">
            {row.cashier.fullName ?? '—'}
            {multiBranch ? ` · ${row.branchName}` : ''}
          </span>
        </>
      ),
    },
    {
      key: 'time',
      header: 'الوقت',
      cell: (row) => <span className="sx-n sx-mute">{zonedClock(row.deviceTime, tz, digits)}</span>,
    },
    {
      key: 'customer',
      header: 'الزبون',
      cell: (row) => row.customer?.name ?? <span className="sx-sub">—</span>,
    },
    {
      key: 'method',
      header: 'الدفع',
      hideBelowLg: true,
      cell: (row) => (
        <span className="sx-mute">{row.methods.map((m) => METHOD_TEXT[m]).join(' + ') || '—'}</span>
      ),
    },
    { key: 'status', header: 'الحالة', cell: (row) => <SaleStatusBadge status={row.status} /> },
    {
      key: 'total',
      header: 'الإجمالي',
      numeric: true,
      strong: true,
      cellClass: (row) => (row.status === 'returned' ? 'neg' : undefined),
      cell: (row) => <Amt minor={row.totalMinor} currency={row.currency} />,
    },
  ];

  const emptyState = (
    <EmptyState
      icon={SalesIcon}
      title={invalid ? 'صحّح الخانات المعلَّمة أولاً.' : 'لا فواتير بهذه الشروط.'}
      description={
        invalid
          ? 'لا نبحث قبل أن تصحّ البيانات.'
          : 'غيّر المدة أو الفرع أو البحث. تظهر الفاتورة هنا حين يرسلها جهاز الكاشير.'
      }
    />
  );

  return (
    <ReportScreen me={me} access={INVOICES_ACCESS} title="الفواتير">
      <SalesPage>
        <PageTop
          title="الفواتير"
          subtitle="ابحث عن أي فاتورة، افتحها كما طُبعت، واطبعها من جديد"
          actions={
            <Button
              variant="ghost"
              icon={<DownloadGlyph size={20} />}
              loading={exporting}
              disabled={loading || items.length === 0 || invalid}
              onClick={() => void exportCsv()}
            >
              {exporting && exportCount > 0
                ? `نصدّر… ${exportCount.toLocaleString('en-US')}`
                : 'صدّر إلى إكسل'}
            </Button>
          }
        />
        <div ref={barRef} className="sx-card sx-filterbar print:hidden">
          <div className="sx-search">
            <SearchField
              label="ابحث برقم الفاتورة أو اسم الزبون"
              placeholder="رقم الفاتورة أو الزبون أو السيريال"
              value={typed}
              onValueChange={setTyped}
              aria-invalid={searchError ? true : undefined}
              aria-describedby={searchError || refused?.q ? 'invoice-search-error' : undefined}
            />
            {searchError || refused?.q ? (
              <p id="invoice-search-error" role="alert" className="mt-1 text-sm text-danger-ink">
                {searchError ?? SERVER_FIELD_TEXT.q}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="sx-fbtn sx-range"
            aria-expanded={shown === 'date'}
            aria-controls="invoice-days"
            onClick={() => setPop(pop === 'date' ? null : 'date')}
          >
            <CalendarIcon size={16} />
            <span className="txt sx-n">{rangeText(from, to, digits)}</span>
            <ChevDown size={14} />
          </button>
          <button
            type="button"
            className="sx-fbtn"
            aria-expanded={shown === 'filter'}
            aria-controls="invoice-filters"
            onClick={() => setPop(pop === 'filter' ? null : 'filter')}
          >
            <FilterGlyph />
            تصفية
            {active.length > 0 ? <span className="cnt sx-n">{active.length}</span> : null}
          </button>

          <div className="sx-scrim" hidden={shown === null} aria-hidden="true" onClick={() => setPop(null)} />
          <div
            id="invoice-days"
            role="group"
            aria-label="المدة"
            className="sx-pop date"
            hidden={shown !== 'date'}
          >
            <span className="sx-grab" aria-hidden="true" />
            <h3>المدة</h3>
            <div className="sx-chips">
              {PERIOD_KEYS.map((key) => (
                <label key={key} className="sx-chip">
                  <input
                    type="radio"
                    name="invoice-period"
                    checked={periodOf({ from, to }, today) === key}
                    onChange={() => {
                      const next = periodRange(key, today);
                      setFrom(next.from);
                      setTo(next.to);
                    }}
                  />
                  {PERIOD_LABELS[key]}
                </label>
              ))}
            </div>
            <div className="sx-fgrid">
              <DateField label="من" value={from} max={to} required onChange={setFrom} />
              <DateField
                label="إلى"
                value={to}
                max={today}
                required
                onChange={(day) => setTo(day < from ? from : day)}
              />
            </div>
          </div>
          <div
            id="invoice-filters"
            role="group"
            aria-label="تصفية الفواتير"
            className="sx-pop"
            hidden={shown !== 'filter'}
          >
            <span className="sx-grab" aria-hidden="true" />
            <h3>تصفية الفواتير</h3>
            <div className="sx-fgrid">
              <BranchSelect me={me} value={branchId} onChange={setBranchId} className="min-w-0" />
              <Select label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">الكل</option>
                {(Object.keys(METHOD_TEXT) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {METHOD_TEXT[m]}
                  </option>
                ))}
              </Select>
              <Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">الكل</option>
                {(Object.keys(SALE_STATUS_TEXT) as SaleStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {SALE_STATUS_TEXT[s]}
                  </option>
                ))}
              </Select>
              <Select label="الكاشير" value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
                <option value="">الكل</option>
                {[...seen.cashiers].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select label="الجهاز" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">الكل</option>
                {[...seen.devices].map(([id, code]) => (
                  <option key={id} value={id}>
                    {code}
                  </option>
                ))}
              </Select>
              <div />
              <TextField
                label="أقل مبلغ"
                inputMode="decimal"
                dir="ltr"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                error={minError ?? (refused?.minTotal ? SERVER_FIELD_TEXT.minTotal : undefined)}
              />
              <TextField
                label="أكثر مبلغ"
                inputMode="decimal"
                dir="ltr"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                error={maxError ?? (refused?.maxTotal ? SERVER_FIELD_TEXT.maxTotal : undefined)}
              />
            </div>
            <div className="sx-pop-f">
              <Button variant="ghost" size="sm" onClick={clearAll} disabled={active.length === 0}>
                امسح الكل
              </Button>
              <Button onClick={() => setPop(null)} disabled={fieldProblem}>
                {found === null ? 'تم' : `اعرض ${invoicesNoun(found)}`}
              </Button>
            </div>
          </div>
        </div>
        {active.length > 0 ? (
          <div className="sx-chips scroll" aria-label="التصفية الحالية" role="group">
            {active.map((chip) => (
              <span key={chip.key} className="sx-chip rm">
                {chip.label}
                <button type="button" aria-label={`أزل: ${chip.label}`} onClick={chip.clear}>
                  <CloseIcon size={16} />
                </button>
              </span>
            ))}
            <button type="button" className="sx-linkbtn" onClick={clearAll}>
              امسح الكل
            </button>
          </div>
        ) : null}

        {customerId ? (
          <Alert tone="info">
            فواتير زبون واحد.{' '}
            <Link to={`/customers/${encodeURIComponent(customerId)}`} className="font-semibold underline">
              ارجع إلى الزبون
            </Link>
          </Alert>
        ) : null}
        {exportError ? <Alert tone="error">{exportError}</Alert> : null}
        {exportNote ? <Alert tone={exportNote.tone}>{exportNote.text}</Alert> : null}
        {refused?.from || refused?.to ? (
          <Alert tone="error">{refused.from ? SERVER_FIELD_TEXT.from : SERVER_FIELD_TEXT.to}</Alert>
        ) : null}
        <TotalsStrip
          summary={invalid || summary.key !== fetchKey ? null : (summary.data ?? 'failed')}
          waiting={!invalid && summary.key !== fetchKey}
          base={base}
        />
        <div ref={topRef}>
          {phone && items.length > 0 && !loading ? (
            <ul className="sx-cards" aria-label="فواتير المتجر">
              {items.flatMap((row, index) => {
                const out = [];
                if (index === 0 || items[index - 1]!.businessDate !== row.businessDate) {
                  const count = items.filter((r) => r.businessDate === row.businessDate).length;
                  out.push(
                    <li key={`d-${row.businessDate}`} className="sx-dayh">
                      {dayText(row.businessDate, digits)}{' '}
                      <span>
                        · {weekdayName(row.businessDate)} · {invoicesNoun(count)}
                      </span>
                    </li>,
                  );
                }
                const extra = [row.customer?.name, row.methods.map((m) => METHOD_TEXT[m]).join(' + ')]
                  .filter(Boolean)
                  .join(' · ');
                out.push(
                  <li key={row.id}>
                    <button type="button" className="sx-icard" onClick={() => setOpenId(row.id)}>
                      <span className="n">{row.number}</span>
                      <span className="st">
                        <SaleStatusBadge status={row.status} />
                      </span>
                      <span className="d sx-n">{zonedClock(row.deviceTime, tz, digits)}</span>
                      <span className={`t ${row.status === 'returned' ? 'sx-neg' : ''}`}>
                        <Amt minor={row.totalMinor} currency={row.currency} />
                      </span>
                      {extra ? <span className="x">{extra}</span> : null}
                    </button>
                  </li>,
                );
                return out;
              })}
            </ul>
          ) : (
            <SxTable
              caption="فواتير المتجر"
              columns={columns}
              rows={items}
              rowKey={(row) => row.id}
              groupOf={dayGroup}
              groupLabel={dayLabel}
              onRowClick={(row) => setOpenId(row.id)}
              loading={loading}
              error={refused ? undefined : (error ?? undefined)}
              onRetry={retry}
              empty={emptyState}
            />
          )}
        </div>
        <Pager noun="الفواتير" pager={pager} />
        <InvoiceSheet id={openId} onClose={() => setOpenId(null)} />
      </SalesPage>
    </ReportScreen>
  );
}

/** «عدد الفواتير · الإجمالي · المرتجعات · الصافي» of the current filter, one strip per currency. */
function TotalsStrip({
  summary,
  waiting,
  base,
}: {
  summary: SaleSummary | 'failed' | null;
  waiting: boolean;
  base: CurrencyCode;
}) {
  if (waiting) {
    return (
      <p role="status" className="sx-wait">
        نحسب المجاميع…
      </p>
    );
  }
  if (summary === 'failed') {
    return <p className="sx-wait">تعذّر حساب المجاميع الآن. القائمة تحتها صحيحة.</p>;
  }
  if (!summary || summary.totals.length === 0) return null;
  const rows = [...summary.totals].sort((a, b) => Number(b.currency === base) - Number(a.currency === base));
  return (
    <section aria-label="مجاميع الفواتير" className="flex flex-col gap-3">
      {rows.map((t) => (
        <div key={t.currency} className="sx-card sx-strip">
          <div>
            <span className="sx-eyebrow">نتائج التصفية</span>
            <span className="v sx-n">
              {t.count.toLocaleString('en-US')} <small>فاتورة</small>
            </span>
          </div>
          <div>
            <span className="sx-eyebrow">إجمالي الفواتير</span>
            <span className="v">
              <Amt minor={t.grossMinor} currency={t.currency} />
            </span>
          </div>
          <div>
            <span className="sx-eyebrow">المرتجعات</span>
            <span className="v">
              <Amt minor={t.returnsMinor} currency={t.currency} neg={t.returnsMinor > 0} />
            </span>
          </div>
          <div>
            <span className="sx-eyebrow">الصافي بعد المرتجعات</span>
            <span className="v">
              <Amt minor={t.netMinor} currency={t.currency} />
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
