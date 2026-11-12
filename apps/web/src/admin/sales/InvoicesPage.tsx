import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  getCurrency,
  type CurrencyCode,
  type PaymentMethod,
  type SaleListItem,
  type SaleStatus,
} from '@serva/core';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Money,
  SalesIcon,
  SearchField,
  Select,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay, monthStart, zonedClock } from '../../lib/dates';
import {
  BranchSelect,
  DayField,
  defaultBranch,
  PageHead,
  ReportFilters,
  ReportScreen,
} from '../reports/parts';
import { listSales, type SaleFilters } from './api';
import { salesCsv } from './csv';
import { downloadText } from '../accounting/csv';
import { StatusBadge, InvoiceSheet } from './InvoiceSheet';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';

/** The server's check is report.view alone (reports.financial does not open the invoice list). */
export const INVOICES_ACCESS = ['report.view'] as const;

/** The most rows one CSV takes, so a huge store's export stays a file a spreadsheet opens. */
const CSV_MAX_PAGES = 50;

/** «1250.5» in an invoice's currency → «125050» minor units; null for anything else. */
export function toMinor(text: string, currency: CurrencyCode): string | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const { decimals } = getCurrency(currency);
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) return null;
  return String(Number(`${whole}${fraction.padEnd(decimals, '0')}`));
}

function useInvoices(filters: SaleFilters) {
  const key = JSON.stringify(filters);
  const [state, setState] = useState<{
    key: string | null;
    items: SaleListItem[];
    cursor: string | null;
    error: string | null;
  }>({ key: null, items: [], cursor: null, error: null });
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    let current = true;
    setMoreError(null);
    listSales(filtersRef.current, null).then(
      (page) => current && setState({ key, items: page.items, cursor: page.nextCursor, error: null }),
      (error: unknown) => current && setState({ key, items: [], cursor: null, error: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const fresh = state.key === key;
  const loadMore = useCallback(async () => {
    if (!state.cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listSales(filtersRef.current, state.cursor);
      setState((s) =>
        s.key === key ? { ...s, items: [...s.items, ...page.items], cursor: page.nextCursor } : s,
      );
    } catch (error) {
      setMoreError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [state.cursor, key]);

  return {
    items: fresh ? state.items : [],
    cursor: fresh ? state.cursor : null,
    error: fresh ? state.error : null,
    loading: !fresh,
    loadingMore,
    moreError,
    loadMore,
    retry: () => {
      setState((s) => ({ ...s, key: null }));
      setAttempt((n) => n + 1);
    },
  };
}

/**
 * «الفواتير»: every sale of the store, found by its number, its customer, its day, its payment or
 * its amount; each opens as it was printed, to print again or to export the list as CSV.
 */
export function InvoicesPage() {
  const me = useMe();
  const digits = useDigits();
  const [params] = useSearchParams();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const base = me.settings.baseCurrency;
  const customerId = params.get('customerId');
  const [from, setFrom] = useState(customerId ? '2020-01-01' : monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const minMinor = toMinor(min, base);
  const maxMinor = toMinor(max, base);
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
  const { items, cursor, error, loading, loadingMore, moreError, loadMore, retry } = useInvoices(filters);

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

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const all: SaleListItem[] = [];
      let next: string | null = null;
      for (let pages = 0; pages < CSV_MAX_PAGES; pages += 1) {
        const page = await listSales(filters, next, 200);
        all.push(...page.items);
        next = page.nextCursor;
        if (!next) break;
      }
      downloadText(`الفواتير-${from}-${to}.csv`, salesCsv(all));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const tz = me.tenant.timezone;
  const columns: DataColumn<SaleListItem>[] = [
    {
      key: 'number',
      header: 'الفاتورة',
      cell: (row) => (
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setOpenId(row.id)}
            className="inline-flex min-h-11 items-center self-start font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            <bdi className="num" dir="ltr">
              {row.number}
            </bdi>
          </button>
          <span className="text-xs text-ink-muted sm:hidden">
            {row.customer?.name ?? 'بلا زبون'} · {row.methods.map((m) => METHOD_TEXT[m]).join(' + ')}
          </span>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (row) => (
        <span className="flex flex-col">
          <span>{dayText(row.businessDate, digits)}</span>
          <span className="num text-xs text-ink-muted">{zonedClock(row.deviceTime, tz, digits)}</span>
        </span>
      ),
    },
    { key: 'branch', header: 'الفرع', cell: (row) => row.branchName, className: 'hidden lg:table-cell' },
    {
      key: 'cashier',
      header: 'الكاشير',
      cell: (row) => row.cashier.fullName ?? '—',
      className: 'hidden lg:table-cell',
    },
    {
      key: 'customer',
      header: 'الزبون',
      cell: (row) => row.customer?.name ?? '—',
      className: 'hidden sm:table-cell',
    },
    {
      key: 'method',
      header: 'الدفع',
      cell: (row) => row.methods.map((m) => METHOD_TEXT[m]).join(' + ') || '—',
      className: 'hidden md:table-cell',
    },
    { key: 'status', header: 'الحالة', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'total',
      header: 'الإجمالي',
      numeric: true,
      cell: (row) => <Money minor={row.totalMinor} currency={row.currency} />,
    },
  ];

  return (
    <ReportScreen me={me} access={INVOICES_ACCESS} title="الفواتير">
      <PageHead
        icon={<SalesIcon />}
        title="الفواتير"
        subtitle="ابحث عن أي فاتورة، افتحها كما طُبعت، واطبعها من جديد"
        actions={
          <Button
            variant="secondary"
            loading={exporting}
            disabled={loading || items.length === 0}
            onClick={() => void exportCsv()}
          >
            صدّر CSV
          </Button>
        }
      />
      <ReportFilters>
        <SearchField
          label="ابحث برقم الفاتورة أو اسم الزبون"
          placeholder="رقم الفاتورة أو الزبون"
          value={typed}
          onValueChange={setTyped}
          className="min-w-56"
        />
        <DayField label="من" value={from} max={to} onChange={setFrom} />
        <DayField label="إلى" value={to} max={today} onChange={(day) => setTo(day < from ? from : day)} />
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
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
        <TextField
          label="أقل مبلغ"
          inputMode="decimal"
          dir="ltr"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          error={min && minMinor === null ? 'اكتب رقماً' : undefined}
          className="w-32"
        />
        <TextField
          label="أكثر مبلغ"
          inputMode="decimal"
          dir="ltr"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          error={max && maxMinor === null ? 'اكتب رقماً' : undefined}
          className="w-32"
        />
      </ReportFilters>
      {customerId ? (
        <Alert tone="info">
          فواتير زبون واحد.{' '}
          <Link to={`/customers/${encodeURIComponent(customerId)}`} className="font-semibold underline">
            ارجع إلى الزبون
          </Link>
        </Alert>
      ) : null}
      {exportError ? <Alert tone="error">{exportError}</Alert> : null}
      <DataTable
        caption="فواتير المتجر"
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ?? undefined}
        onRetry={retry}
        empty={
          <EmptyState
            icon={SalesIcon}
            title="لا فواتير بهذه الشروط."
            description="غيّر المدة أو الفرع أو البحث. تظهر الفاتورة هنا حين يرسلها جهاز الكاشير."
          />
        }
      />
      {moreError ? <Alert tone="error">{moreError}</Alert> : null}
      {cursor && !loading ? (
        <Card className="!border-0 !bg-transparent !p-0 !shadow-none">
          <Button
            variant="secondary"
            className="mx-auto"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            اعرض المزيد
          </Button>
        </Card>
      ) : null}
      <InvoiceSheet id={openId} onClose={() => setOpenId(null)} />
    </ReportScreen>
  );
}
