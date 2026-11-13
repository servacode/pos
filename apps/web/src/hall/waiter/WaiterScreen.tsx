import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HallCommand, HallLine, HallMenuResponse, HallOrder, HallResponse } from '@serva/core';
import type { CurrencyCode } from '@serva/core/currencies';
import { Alert, Avatar, Badge, Button, cn, EmptyState, LogoutIcon, Skeleton, UserIcon } from '@serva/ui';
import { PinPad, type PinStatus } from '../../pos/PinScreen';
import type { StaffSessionAnswer } from '../../pos/staff/staffApi';
import type { HallApi } from '../api';
import { usePoll } from '../usePoll';
import { AddItemView, type DraftLine } from './AddItemView';
import { MoveView } from './MoveView';
import { CancelView, OrderView } from './OrderView';

type View =
  | { kind: 'hall' }
  | { kind: 'table'; table: string }
  | { kind: 'add'; table: string }
  | { kind: 'move'; table: string }
  | { kind: 'cancel'; table: string; lineId: string };

interface Waiter {
  id: string;
  fullName: string;
}

export type SignIn = (userId: string, pin: string) => Promise<StaffSessionAnswer>;

function SignInView({
  staff,
  signIn,
  onSignedIn,
}: {
  staff: HallMenuResponse['staff'];
  signIn: SignIn;
  onSignedIn: (waiter: Waiter) => void;
}) {
  const [picked, setPicked] = useState<HallMenuResponse['staff'][number] | null>(null);
  const [status, setStatus] = useState<PinStatus>({ kind: 'idle' });
  const failures = useRef(0);

  async function check(pin: string) {
    if (!picked) return;
    setStatus({ kind: 'checking' });
    const answer = await signIn(picked.id, pin);
    if (answer.kind === 'ok') {
      const allowed = answer.body.permissions.some((p) => p === 'hall.order' || p === 'sale.create');
      if (allowed) return onSignedIn({ id: picked.id, fullName: answer.body.fullName });
      return setStatus({ kind: 'message', text: 'هذا الاسم لا يملك صلاحية أخذ الطلبات.' });
    }
    if (answer.kind === 'invalid') {
      failures.current += 1;
      return setStatus({ kind: 'wrong', failures: failures.current });
    }
    if (answer.kind === 'locked') {
      return setStatus({ kind: 'locked', until: Date.now() + answer.retryAfterSeconds * 1000 });
    }
    if (answer.kind === 'refused') {
      return setStatus({ kind: 'message', text: 'هذا الاسم لا يدخل على هذا الجهاز.' });
    }
    setStatus({ kind: 'message', text: 'لا يوجد اتصال بالخادم. دخول النادل يحتاج الإنترنت.' });
  }

  return (
    <section aria-label="دخول النادل" className="flex flex-col items-center gap-5">
      <h1 className="text-2xl font-bold">من يعمل الآن؟</h1>
      {staff.length === 0 ? (
        <Alert tone="warning">لا نُدُل لهم رمز دخول في هذا الفرع. أضفهم من المستخدمين في الإدارة.</Alert>
      ) : (
        <ul className="grid w-full grid-cols-2 gap-3">
          {staff.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                aria-pressed={picked?.id === person.id}
                onClick={() => {
                  setPicked(person);
                  setStatus({ kind: 'idle' });
                  failures.current = 0;
                }}
                className={cn(
                  'flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-card border bg-surface p-3 shadow-e1',
                  picked?.id === person.id ? 'border-brand ring-2 ring-brand' : 'border-line',
                )}
              >
                <Avatar name={person.fullName} />
                <span className="font-semibold">{person.fullName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked ? (
        <PinPad
          key={picked.id}
          length={picked.pinLength}
          label={`رمز ${picked.fullName}`}
          status={status}
          onComplete={check}
        />
      ) : null}
    </section>
  );
}

function stateOf(order: HallOrder | undefined): 'free' | 'busy' | 'bill' {
  return !order ? 'free' : order.status === 'bill_requested' ? 'bill' : 'busy';
}

const STATE_CLASS = {
  free: 'border-line bg-surface',
  busy: 'border-warning/30 bg-warning-soft',
  bill: 'border-info/30 bg-info-soft',
} as const;

const STATE_TEXT = { free: 'فارغة', busy: 'مشغولة', bill: 'بانتظار الحساب' } as const;

/** «جاهز»: the lines the kitchen finished, across the hall, newest information first */
function readyLines(orders: readonly HallOrder[]): { table: string; line: HallLine }[] {
  return orders.flatMap((o) =>
    o.lines.filter((l) => l.status === 'ready').map((line) => ({ table: o.table, line })),
  );
}

function HallMap({
  tables,
  orders,
  alerts,
  onPick,
}: {
  tables: readonly string[];
  orders: readonly HallOrder[];
  alerts: string[];
  onPick: (table: string) => void;
}) {
  const byTable = new Map(orders.map((o) => [o.table, o]));
  return (
    <section aria-label="الطاولات" className="flex flex-col gap-4">
      {alerts.length > 0 ? (
        <div role="status" className="flex flex-col gap-2">
          {alerts.map((text) => (
            <Alert key={text} tone="success">
              {text}
            </Alert>
          ))}
        </div>
      ) : null}
      {tables.length === 0 ? (
        <EmptyState
          icon={UserIcon}
          title="لا طاولات في هذا المتجر"
          description="يضيفها المالك من إعدادات المتجر."
        />
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {tables.map((table) => {
            const order = byTable.get(table);
            const state = stateOf(order);
            const ready = order?.lines.filter((l) => l.status === 'ready').length ?? 0;
            return (
              <li key={table}>
                <button
                  type="button"
                  onClick={() => onPick(table)}
                  aria-label={`طاولة ${table} ${STATE_TEXT[state]}${ready ? `، ${ready} جاهز` : ''}`}
                  className={cn(
                    'relative flex h-24 w-full flex-col items-center justify-center gap-1 rounded-card border text-ink shadow-e1',
                    STATE_CLASS[state],
                    ready > 0 && 'ring-2 ring-success',
                  )}
                >
                  <span className="num text-2xl font-bold">{table}</span>
                  <span className="text-sm text-ink-muted">{STATE_TEXT[state]}</span>
                  {ready > 0 ? (
                    <Badge tone="success" className="absolute top-1.5 end-1.5">
                      {ready} جاهز
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * «وضع النادل» on a phone (03 › المطاعم): sign in with the PIN, the hall map, a table's order, add
 * items with choices, note and seat, send to the kitchen, see «جاهز», ask for the bill. Everything
 * goes through the server; the waiter takes no payment and issues no invoice.
 */
export function WaiterScreen({
  api,
  signIn,
  deviceName,
  pollMs = 4000,
}: {
  api: HallApi;
  signIn: SignIn;
  deviceName?: string;
  pollMs?: number;
}) {
  const [menu, setMenu] = useState<HallMenuResponse | null>(null);
  const [menuProblem, setMenuProblem] = useState<string | null>(null);
  const [waiter, setWaiter] = useState<Waiter | null>(null);
  const [view, setView] = useState<View>({ kind: 'hall' });
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = useState<PinStatus>({ kind: 'idle' });
  const [alerts, setAlerts] = useState<string[]>([]);
  const knownReady = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    void api.menu().then((answer) => {
      if (!alive) return;
      if (answer.kind === 'ok') setMenu(answer.body);
      else
        setMenuProblem(
          answer.kind === 'refused' ? answer.message : 'لا يوجد اتصال بالخادم. أعد تحميل الصفحة.',
        );
    });
    return () => {
      alive = false;
    };
  }, [api]);

  const hall = usePoll<HallResponse>(() => api.hall(), pollMs);
  const orders = useMemo(() => hall.data?.orders ?? [], [hall.data]);

  // A line that turned «جاهز» since the last look raises an alert at the top of the hall map
  useEffect(() => {
    if (!hall.data) return;
    const ready = readyLines(orders);
    const ids = new Set(ready.map((r) => r.line.id));
    const before = knownReady.current;
    knownReady.current = ids;
    if (!before) return;
    const fresh = ready.filter((r) => !before.has(r.line.id));
    if (fresh.length > 0) {
      setAlerts((now) =>
        [...fresh.map((r) => `جاهز: ${r.line.name} · طاولة ${r.table}`), ...now].slice(0, 4),
      );
    }
  }, [hall.data, orders]);

  async function run(command: HallCommand, then?: () => void) {
    setBusy(true);
    setProblem(null);
    const answer = await api.command(command);
    setBusy(false);
    if (answer.kind === 'ok') {
      void hall.refresh();
      then?.();
      return true;
    }
    setProblem(answer.kind === 'refused' ? answer.message : 'لا يوجد اتصال بالخادم. أعد المحاولة.');
    return false;
  }

  if (menuProblem) {
    return (
      <main className="p-4">
        <Alert tone="error">{menuProblem}</Alert>
      </main>
    );
  }

  const shell = (title: string, children: ReactNode) => (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <h1 className="text-lg font-bold">{title}</h1>
        {deviceName ? <span className="text-sm text-ink-muted">{deviceName}</span> : null}
        <span className="flex-1" />
        {!hall.online ? <Badge tone="warning">بلا اتصال</Badge> : null}
        {waiter ? (
          <Button
            variant="ghost"
            size="md"
            icon={<LogoutIcon size={16} />}
            onClick={() => {
              setWaiter(null);
              setView({ kind: 'hall' });
              setDraft([]);
            }}
          >
            خروج
          </Button>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-6">
        {hall.refusal ? <Alert tone="error">{hall.refusal}</Alert> : null}
        {problem ? <Alert tone="error">{problem}</Alert> : null}
        {children}
      </main>
    </div>
  );

  if (!menu) return shell('النادل', <Skeleton className="h-40 w-full" />);
  if (!waiter) {
    return shell('النادل', <SignInView staff={menu.staff} signIn={signIn} onSignedIn={setWaiter} />);
  }

  const tables = hall.data?.tables ?? menu.tables;
  const currency = menu.currency as CurrencyCode;
  const orderOf = (table: string) => orders.find((o) => o.table === table);

  if (view.kind === 'hall') {
    return shell(
      waiter.fullName,
      <HallMap
        tables={tables}
        orders={orders}
        alerts={alerts}
        onPick={(table) => {
          setAlerts([]);
          setView({ kind: 'table', table });
        }}
      />,
    );
  }

  const order = orderOf(view.table);

  if (view.kind === 'table') {
    if (!order) {
      return shell(
        `طاولة ${view.table}`,
        <section aria-label={`فتح الطاولة ${view.table}`} className="flex flex-col gap-4">
          <p className="text-lg">
            الطاولة <span className="num font-bold">{view.table}</span> فارغة.
          </p>
          <Button
            size="lg"
            disabled={busy}
            onClick={() => void run({ type: 'open', userId: waiter.id, table: view.table, guests: 2 })}
          >
            افتح الطاولة
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setView({ kind: 'hall' })}>
            الطاولات
          </Button>
        </section>,
      );
    }
    return shell(
      `طاولة ${view.table}`,
      <OrderView
        order={order}
        menu={menu}
        busy={busy}
        onAdd={() => setView({ kind: 'add', table: view.table })}
        onSend={() => void run({ type: 'send', userId: waiter.id, orderId: order.id })}
        onBill={() => void run({ type: 'bill', userId: waiter.id, orderId: order.id })}
        onRemove={(line) =>
          void run({ type: 'remove', userId: waiter.id, orderId: order.id, lineId: line.id })
        }
        onServe={(lines) =>
          void run({ type: 'serve', userId: waiter.id, orderId: order.id, lineIds: lines.map((l) => l.id) })
        }
        onCancel={(line) => {
          setCancelStatus({ kind: 'idle' });
          setView({ kind: 'cancel', table: view.table, lineId: line.id });
        }}
        onMove={() => setView({ kind: 'move', table: view.table })}
        onBack={() => setView({ kind: 'hall' })}
      />,
    );
  }

  if (view.kind === 'move') {
    if (!order) {
      return shell('النادل', <Button onClick={() => setView({ kind: 'hall' })}>الطاولات</Button>);
    }
    return shell(
      `طاولة ${view.table}`,
      <MoveView
        order={order}
        tables={tables}
        orders={orders}
        busy={busy}
        onBack={() => setView({ kind: 'table', table: view.table })}
        onMove={(table) =>
          void run({ type: 'move', userId: waiter.id, orderId: order.id, table }, () =>
            setView({ kind: 'table', table }),
          )
        }
        onMerge={(from) =>
          void run({ type: 'merge', userId: waiter.id, orderId: from.id, fromOrderId: order.id }, () =>
            setView({ kind: 'table', table: from.table }),
          )
        }
      />,
    );
  }

  if (view.kind === 'add') {
    return shell(
      `طاولة ${view.table}`,
      <AddItemView
        items={menu.items}
        currency={currency}
        draft={draft}
        setDraft={setDraft}
        onBack={() => setView({ kind: 'table', table: view.table })}
        onDone={() => {
          if (!order) return;
          void run(
            {
              type: 'add',
              userId: waiter.id,
              orderId: order.id,
              lines: draft.map(({ productId, variantId, name, qty, choices, note, seat }) => ({
                productId,
                variantId,
                name,
                qty,
                choices,
                note,
                seat,
              })),
            },
            () => {
              setDraft([]);
              setView({ kind: 'table', table: view.table });
            },
          );
        }}
      />,
    );
  }

  const line = order?.lines.find((l) => l.id === view.lineId);
  if (!order || !line) {
    return shell('النادل', <Button onClick={() => setView({ kind: 'hall' })}>الطاولات</Button>);
  }
  return shell(
    `طاولة ${view.table}`,
    <CancelView
      line={line}
      approvers={menu.approvers}
      status={cancelStatus}
      busy={busy}
      onBack={() => setView({ kind: 'table', table: view.table })}
      onConfirm={async ({ reason, approverId, pin }) => {
        setBusy(true);
        setProblem(null);
        const answer = await api.command({
          type: 'cancel',
          userId: waiter.id,
          orderId: order.id,
          lineId: line.id,
          reason,
          approverId,
          approverPin: pin,
        });
        setBusy(false);
        if (answer.kind === 'ok') {
          void hall.refresh();
          return setView({ kind: 'table', table: view.table });
        }
        if (answer.kind === 'refused' && answer.code === 'pin_invalid') {
          return setCancelStatus({ kind: 'wrong', failures: 1 });
        }
        if (answer.kind === 'refused' && answer.code === 'locked') {
          return setCancelStatus({
            kind: 'locked',
            until: Date.now() + (answer.retryAfterSeconds ?? 60) * 1000,
          });
        }
        setCancelStatus({
          kind: 'message',
          text: answer.kind === 'refused' ? answer.message : 'لا يوجد اتصال بالخادم. أعد المحاولة.',
        });
      }}
    />,
  );
}
