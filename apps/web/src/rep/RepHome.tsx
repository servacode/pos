import { useState } from 'react';
import type { SalesOrderPullRow } from '@serva/core/distribution';
import type { BranchRow } from '@serva/core/contracts/catalog';
import {
  Badge,
  Button,
  CashIcon,
  ConnectionPill,
  HomeIcon,
  ListIcon,
  LockIcon,
  PackageOpenIcon,
  PhoneShell,
  PhoneTab,
  PrintIcon,
  StockIcon,
  TruckIcon,
  Alert,
} from '@serva/ui';
import type { Catalog } from '../pos/catalog';
import type { OpenShift } from '../pos/shift/shift';
import type { StaffSession } from '../pos/staff/staff';
import { usePos } from '../pos/services';
import type { OutboxStatus } from '../pos/StatusBar';
import { CustomerPage } from './CustomerPage';
import { DayStart } from './DayStart';
import { DayTab } from './DayTab';
import { NewCustomer, NoSaleDialog } from './NewCustomer';
import { OrderScreen } from './OrderScreen';
import { OrdersTab } from './OrdersTab';
import { RouteTab } from './RouteTab';
import { StockTab } from './StockTab';
import { useRepRequired } from './state';

export interface RepHomeProps {
  session: StaffSession;
  catalog: Catalog;
  shift: OpenShift | null;
  online: boolean;
  outbox: OutboxStatus | null;
  persisted: boolean | null;
  onShiftOpened: (shift: OpenShift) => void;
  onSell: (customer: { id: string; name: string }, order?: SalesOrderPullRow) => void;
  onReturn: (customer: { id: string; name: string }) => void;
  onCollect: (customer: { id: string; name: string }) => void;
  onCash: () => void;
  onCloseShift: () => void;
  onLock: () => void;
  onPrinter: () => void;
}

type Tab = 'route' | 'orders' | 'van' | 'day' | 'more';
type Screen = null | { kind: 'order'; customerId: string } | { kind: 'new' };

/**
 * «وضع المندوب» (docs/specs/32-sales-reps.md): the rep's day on his phone. Before the shift opens it
 * is the day's start; after, the route with each visit's outcome, the customer's page, the orders,
 * the van's stock, and the day's summary with its way to the end. A sale, a receipt and a return are
 * the till's own screens (CashierApp opens them with the customer already picked).
 */
export function RepHome(props: RepHomeProps) {
  const { session, catalog, shift, online, outbox } = props;
  const pos = usePos();
  const rep = useRepRequired();
  const [tab, setTab] = useState<Tab>('route');
  const [screen, setScreen] = useState<Screen>(null);
  const [noSale, setNoSale] = useState(false);
  const base = catalog.settings?.baseCurrency ?? 'SYP';
  // The van is this device's own branch; a rep who carries nothing has an empty one, and orders fill from its home branch
  const branches = catalog.staff.branches as BranchRow[];
  const van = branches.find((b) => b.code === pos.device.branchCode) ?? null;
  const vanBranchId = van?.id ?? null;
  const warehouseId = van?.parentBranchId ?? van?.id ?? null;
  const customerId = rep.activeCustomerId;
  const names = new Map(catalog.customers.map((c) => [c.id, c.name]));

  function go(next: Tab) {
    rep.leave();
    setScreen(null);
    setTab(next);
  }

  const top = (
    <>
      <TruckIcon className="shrink-0 text-brand-ink" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-ink">{session.fullName}</span>
        <span className="truncate text-xs text-ink-muted">
          {rep.sheet?.rep.vanName ?? pos.device.branchName}
          {rep.sheet?.rep.vehiclePlate ? ` · ${rep.sheet.rep.vehiclePlate}` : ''}
        </span>
      </div>
      {outbox && outbox.pending > 0 ? <Badge tone="warning">{outbox.pending} بانتظار الإرسال</Badge> : null}
      <ConnectionPill online={online}>{online ? 'متصل' : 'دون إنترنت'}</ConnectionPill>
    </>
  );

  const tabs = (
    <>
      <PhoneTab
        as="button"
        type="button"
        active={tab === 'route'}
        icon={<HomeIcon size={20} />}
        onClick={() => go('route')}
      >
        المسار
      </PhoneTab>
      <PhoneTab
        as="button"
        type="button"
        active={tab === 'orders'}
        icon={<PackageOpenIcon size={20} />}
        count={rep.orders.filter((o) => o.status === 'open' || o.status === 'partial').length}
        onClick={() => go('orders')}
      >
        الطلبيات
      </PhoneTab>
      <PhoneTab
        as="button"
        type="button"
        active={tab === 'van'}
        icon={<StockIcon size={20} />}
        onClick={() => go('van')}
      >
        السيارة
      </PhoneTab>
      <PhoneTab
        as="button"
        type="button"
        active={tab === 'day'}
        icon={<ListIcon size={20} />}
        onClick={() => go('day')}
      >
        يومي
      </PhoneTab>
      <PhoneTab
        as="button"
        type="button"
        active={tab === 'more'}
        icon={<LockIcon size={20} />}
        onClick={() => go('more')}
      >
        المزيد
      </PhoneTab>
    </>
  );

  // The day has not started: the load, then the shift
  if (!shift) {
    return (
      <PhoneShell top={top}>
        <div className="mx-auto flex w-full max-w-120 flex-col gap-4">
          <DayStart session={session} catalog={catalog} onOpened={props.onShiftOpened} />
        </div>
      </PhoneShell>
    );
  }

  let body;
  if (screen?.kind === 'new') {
    body = (
      <NewCustomer
        catalog={catalog}
        createdBy={session.userId}
        onBack={() => setScreen(null)}
        onCreated={(c) => {
          rep.enter(c.id);
          setScreen(null);
        }}
      />
    );
  } else if (screen?.kind === 'order' && warehouseId) {
    body = (
      <OrderScreen
        customerId={screen.customerId}
        customerName={names.get(screen.customerId) ?? '—'}
        catalog={catalog}
        warehouseBranchId={warehouseId}
        onBack={() => setScreen(null)}
        onDone={() => setScreen(null)}
      />
    );
  } else if (customerId) {
    body = (
      <>
        <CustomerPage
          customerId={customerId}
          session={session}
          baseCurrency={base}
          hasShift
          deliverFrom={vanBranchId}
          onBack={() => setScreen(null)}
          onSell={props.onSell}
          onOrder={() => setScreen({ kind: 'order', customerId })}
          onReturn={props.onReturn}
          onCollect={props.onCollect}
          onNoSale={() => setNoSale(true)}
        />
        {noSale ? (
          <NoSaleDialog
            rep={rep}
            customerId={customerId}
            onClose={() => setNoSale(false)}
            onDone={() => {
              setNoSale(false);
              rep.leave();
            }}
          />
        ) : null}
      </>
    );
  } else if (tab === 'route') {
    body = (
      <RouteTab
        catalog={catalog}
        baseCurrency={base}
        onOpen={(id) => rep.enter(id)}
        onNewCustomer={() => setScreen({ kind: 'new' })}
      />
    );
  } else if (tab === 'orders') {
    body = <OrdersTab catalog={catalog} vanBranchId={vanBranchId} onOpenCustomer={(id) => rep.enter(id)} />;
  } else if (tab === 'van') {
    body = <StockTab catalog={catalog} />;
  } else if (tab === 'day') {
    body = (
      <DayTab
        shift={shift}
        onCountVan={() => setTab('van')}
        onCash={props.onCash}
        onCloseShift={props.onCloseShift}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="lg" icon={<CashIcon />} onClick={props.onCash}>
          حركات الدرج
        </Button>
        <Button variant="secondary" size="lg" icon={<PrintIcon />} onClick={props.onPrinter}>
          الطابعة
        </Button>
        <Button variant="secondary" size="lg" icon={<LockIcon />} onClick={props.onLock}>
          اقفل الشاشة
        </Button>
        {rep.sheetState === 'cached' || rep.sheetState === 'none' ? (
          <Alert tone="info">
            {rep.sheetState === 'none'
              ? 'بيانات اليوم (الأرصدة والأسعار) تصل مع أول اتصال بالإنترنت.'
              : 'الأرصدة المعروضة من آخر اتصال.'}
          </Alert>
        ) : null}
        <Button variant="ghost" onClick={() => void rep.refresh()}>
          حدّث بيانات اليوم
        </Button>
      </div>
    );
  }

  return (
    <PhoneShell top={top} tabs={tabs}>
      {/* A phone's screen: on a wide window it stays a readable column in the middle */}
      <div className="mx-auto flex w-full max-w-120 flex-col gap-4">{body}</div>
    </PhoneShell>
  );
}
