import { useEffect, useMemo, useState } from 'react';
import {
  cashOnly,
  lineRemaining,
  type RepDayCustomer,
  type SalesOrderPullRow,
} from '@serva/core/distribution';
import type { CustomerRow } from '@serva/core/contracts/customers';
import type { Permission } from '@serva/core/permissions';
import {
  Alert,
  Badge,
  Button,
  CashIcon,
  CartIcon,
  ChatIcon,
  Money,
  PackageOpenIcon,
  PhoneIcon,
  TruckIcon,
  UndoIcon,
  BookIcon,
} from '@serva/ui';
import type { StaffSession } from '../pos/staff/staff';
import { deviceDocuments } from '../pos/shift/shift';
import { CustomerHistory } from '../pos/customers/CustomerHistory';
import { usePos } from '../pos/services';
import { localBalanceDelta, type LocalVisit } from './day';
import { Figure, ScreenHead } from './parts';
import { useRepRequired } from './state';
import { VISIT_OUTCOME_LABELS } from '@serva/core/contracts/distribution';

/**
 * One customer on the rep's phone: what he owes, what is overdue, his limit, the orders waiting for
 * him, and what to do now (sell, take an order, collect, return, or say why not). The balance is the
 * server's as of the morning sheet plus what this phone has done since; offline it says so.
 */
export function CustomerPage({
  customerId,
  session,
  baseCurrency,
  hasShift,
  deliverFrom,
  onBack,
  onSell,
  onOrder,
  onReturn,
  onCollect,
  onNoSale,
}: {
  customerId: string;
  session: StaffSession;
  baseCurrency: string;
  hasShift: boolean;
  /** This phone's van branch id: orders to be filled from it can be delivered here */
  deliverFrom: string | null;
  onBack: () => void;
  onSell: (customer: { id: string; name: string }, order?: SalesOrderPullRow) => void;
  onOrder: () => void;
  onReturn: (customer: { id: string; name: string }) => void;
  onCollect: (customer: { id: string; name: string }) => void;
  onNoSale: () => void;
}) {
  const pos = usePos();
  const rep = useRepRequired();
  const [delta, setDelta] = useState(0);
  const [history, setHistory] = useState(false);
  const fromSheet: RepDayCustomer | undefined = rep.sheet?.customers.find((c) => c.id === customerId);
  const fromCatalog = rep.newCustomers.find((c) => c.id === customerId);
  const pulled = useCatalogCustomer(customerId);
  const name = fromSheet?.name ?? pulled?.name ?? fromCatalog?.name ?? '—';
  const phone = fromSheet?.phone ?? pulled?.phone ?? fromCatalog?.phone ?? null;
  const approval =
    pulled?.approvalStatus ?? fromSheet?.approvalStatus ?? (fromCatalog ? 'pending' : 'approved');
  const limit = fromSheet?.creditLimitMinor ?? pulled?.creditLimitMinor ?? null;
  const unapproved = cashOnly(approval);
  const customer = { id: customerId, name };
  const orders = useMemo(
    () =>
      rep.orders.filter(
        (o) => o.customerId === customerId && (o.status === 'open' || o.status === 'partial'),
      ),
    [rep.orders, customerId],
  );
  const deliverable = orders.filter((o) => deliverFrom !== null && o.warehouseBranchId === deliverFrom);
  const took = orders.filter((o) => deliverFrom === null || o.warehouseBranchId !== deliverFrom);
  const visit: LocalVisit | undefined = rep.visits.findLast((v) => v.customerId === customerId);

  // What this phone did to the account since the sheet was fetched
  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((entries) => {
      if (alive) setDelta(localBalanceDelta(entries, customerId, rep.sheetAt ?? 0, baseCurrency));
    });
    return () => {
      alive = false;
    };
  }, [pos.store, customerId, rep.sheetAt, baseCurrency, rep.visits]);

  const balance = fromSheet ? fromSheet.balanceMinor + delta : null;
  const can = (permission: Permission) => session.permissions.has(permission);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead
        title={name}
        onBack={() => {
          rep.leave();
          onBack();
        }}
        aside={
          unapproved ? (
            <Badge tone="warning">بانتظار الموافقة</Badge>
          ) : visit && visit.results.length > 0 ? (
            <Badge tone="success">{VISIT_OUTCOME_LABELS[visit.results[0]!]}</Badge>
          ) : null
        }
      />
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="flex min-h-12 items-center gap-2 text-sm font-semibold text-brand-ink"
        >
          <PhoneIcon size={16} />
          <bdi dir="ltr" className="num">
            {phone}
          </bdi>
        </a>
      ) : null}
      {fromSheet?.address ? <p className="text-sm text-ink-muted">{fromSheet.address}</p> : null}
      {unapproved ? (
        <Alert tone="warning">هذا الزبون بانتظار موافقة المشرف: البيع له نقداً فقط، دون آجل أو شيك.</Alert>
      ) : null}
      {balance === null ? (
        <Alert tone="info">رصيد الزبون يصل مع أول اتصال بالإنترنت.</Alert>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Figure label={balance >= 0 ? 'عليه' : 'له'} tone={balance > 0 ? 'danger' : 'plain'}>
            <Money minor={Math.abs(balance)} currency={baseCurrency as never} />
          </Figure>
          <Figure
            label="متأخر أكثر من 30 يوماً"
            tone={(fromSheet?.overdueMinor ?? 0) > 0 ? 'danger' : 'plain'}
          >
            <Money minor={fromSheet?.overdueMinor ?? 0} currency={baseCurrency as never} />
          </Figure>
          <Figure label="حد الدين">
            {limit === null ? 'بلا حد' : <Money minor={limit} currency={baseCurrency as never} />}
          </Figure>
          <Figure label="آخر بيع">
            {fromSheet?.lastSaleDate ? <bdi dir="ltr">{fromSheet.lastSaleDate}</bdi> : '—'}
          </Figure>
        </div>
      )}

      {deliverable.length > 0 ? (
        <section aria-label="طلبيات للتسليم" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink">طلبيات جاهزة للتسليم من سيارتك</h3>
          {deliverable.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 rounded-card border border-line bg-surface p-3"
            >
              <PackageOpenIcon className="shrink-0 text-ink-muted" />
              <div className="flex min-w-0 flex-1 flex-col">
                <bdi dir="ltr" className="num self-start text-sm font-bold text-ink">
                  {o.number}
                </bdi>
                <span className="text-xs text-ink-muted">
                  {o.lines.filter((l) => lineRemaining(l) > 0).length} صنف
                  {o.deliveryDate ? ` · ${o.deliveryDate}` : ''}
                  {o.status === 'partial' ? ' · مسلّمة جزئياً' : ''}
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<TruckIcon />}
                disabled={!hasShift}
                onClick={() => onSell(customer, o)}
              >
                سلّم
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      {took.length > 0 ? (
        <p className="text-sm text-ink-muted">
          طلبيات أخذتها له وتنتظر التجهيز: {took.map((o) => o.number).join('، ')}
        </p>
      ) : null}

      {!hasShift ? <Alert tone="warning">افتح يومك أولاً لتبيع أو تقبض أو ترتجع.</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        {can('sale.create') ? (
          <Button size="lg" icon={<CartIcon />} disabled={!hasShift} onClick={() => onSell(customer)}>
            بيع
          </Button>
        ) : null}
        {can('rep.order') ? (
          <Button size="lg" variant="secondary" icon={<BookIcon />} onClick={onOrder}>
            طلبية
          </Button>
        ) : null}
        {can('receipt.create') ? (
          <Button
            size="lg"
            variant="secondary"
            icon={<CashIcon />}
            disabled={!hasShift}
            onClick={() => onCollect(customer)}
          >
            قبض
          </Button>
        ) : null}
        {can('sale.refund') ? (
          <Button
            size="lg"
            variant="secondary"
            icon={<UndoIcon />}
            disabled={!hasShift}
            onClick={() => onReturn(customer)}
          >
            مرتجع
          </Button>
        ) : null}
        <Button size="lg" variant="ghost" icon={<ChatIcon />} onClick={onNoSale}>
          لا بيع
        </Button>
        <Button size="lg" variant="ghost" icon={<BookIcon />} onClick={() => setHistory((h) => !h)}>
          كشف الحساب
        </Button>
      </div>
      {history ? <CustomerHistory customerId={customerId} /> : null}
    </div>
  );
}

/** The customer as the till pulled him (his approval, his limit); null while not read or not there */
function useCatalogCustomer(id: string): CustomerRow | null {
  const pos = usePos();
  const [row, setRow] = useState<CustomerRow | null>(null);
  useEffect(() => {
    let alive = true;
    void pos.store.readSet('customers').then((rows) => {
      if (alive) setRow((rows.find((r) => r.id === id) as unknown as CustomerRow | undefined) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [pos.store, id]);
  return row;
}
