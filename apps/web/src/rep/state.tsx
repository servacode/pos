import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { primaryOutcome } from '@serva/core/distribution';
import type {
  NoSaleReasonPullRow,
  RepDaySheet,
  RouteCustomerPullRow,
  RoutePullRow,
  SalesOrderPullRow,
  VisitResult,
} from '@serva/core/distribution';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import type { CustomerRow } from '@serva/core/contracts/customers';
import { businessDateOf } from '@serva/core/sale';
import { uuidv7, type OutboxEntry } from '@serva/sync';
import type { PosServices } from '../pos/services';
import { fetchRepDay, postOrder, postVisit, type VisitReport } from './api';
import {
  arriving,
  customerOfDocument,
  dayList,
  isEmptyVisit,
  leaving,
  mergeServerVisits,
  NEW_CUSTOMERS_KEY,
  ORDER_QUEUE_KEY,
  resultOf,
  SHEET_KEY,
  visitsKey,
  withResult,
  type DayList,
  type LocalVisit,
} from './day';

/** A customer this phone added: pending the supervisor's approval, so cash only, until the server says otherwise */
export interface NewCustomer {
  id: string;
  name: string;
  phone: string | null;
  at: number;
}

export interface QueuedOrder {
  id: string;
  customerId: string;
  warehouseBranchId: string;
  repId: string | null;
  currency: string;
  lines: { variantId: string; qty: number; deliveredQty: number; unitPriceMinor: number }[];
  deliveryDate: string | null;
  note: string | null;
}

export type SheetState = 'loading' | 'fresh' | 'cached' | 'none' | 'forbidden';

export type OrderAnswer =
  { kind: 'sent'; number: string } | { kind: 'queued' } | { kind: 'refused'; message: string };

export interface RepState {
  businessDate: string | null;
  sheet: RepDaySheet | null;
  /** When the sheet was fetched, ms; balances are as of then */
  sheetAt: number | null;
  sheetState: SheetState;
  routes: RoutePullRow[];
  routeCustomers: RouteCustomerPullRow[];
  reasons: NoSaleReasonPullRow[];
  orders: SalesOrderPullRow[];
  newCustomers: NewCustomer[];
  visits: LocalVisit[];
  list: DayList;
  /** The customer the rep is with now */
  activeCustomerId: string | null;
  pendingOrders: number;
  refresh: () => Promise<void>;
  /** The rep arrives at a customer: his page opens and a visit starts (`note`: why, for one off today's route) */
  enter: (customerId: string, note?: string | null) => void;
  leave: () => void;
  noSale: (customerId: string, reasonId: string, note: string | null) => void;
  noteDocument: (type: string, payload: Record<string, unknown>, entry: OutboxEntry) => void;
  submitOrder: (input: Omit<QueuedOrder, 'id'> & { id?: string }) => Promise<OrderAnswer>;
  /** The customers of the catalog with the ones this phone added (pending) on top */
  withLocalCustomers: (customers: readonly CustomerRow[]) => CustomerRow[];
}

const RepContext = createContext<RepState | null>(null);

export function RepProvider({ value, children }: { value: RepState; children: ReactNode }) {
  return <RepContext value={value}>{children}</RepContext>;
}

/** The rep's state, or null on an ordinary till: the cashier app asks, and behaves as ever when it is null */
export function useRep(): RepState | null {
  return useContext(RepContext);
}

export function useRepRequired(): RepState {
  const rep = useRep();
  if (!rep) throw new Error('useRepRequired needs a <RepProvider> above it');
  return rep;
}

const EMPTY_LIST: DayList = { stops: [], routes: [] };

/** Everything the rep's day needs from the device and the server, kept on the device between them */
export function useRepState(pos: PosServices): RepState {
  const { store, local, device, sync } = pos;
  const [businessDate, setBusinessDate] = useState<string | null>(null);
  const [sheet, setSheet] = useState<RepDaySheet | null>(null);
  const [sheetAt, setSheetAt] = useState<number | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>('loading');
  const [sets, setSets] = useState<{
    routes: RoutePullRow[];
    routeCustomers: RouteCustomerPullRow[];
    reasons: NoSaleReasonPullRow[];
    orders: SalesOrderPullRow[];
  }>({ routes: [], routeCustomers: [], reasons: [], orders: [] });
  const [visits, setVisitsState] = useState<LocalVisit[]>([]);
  const [newCustomers, setNewCustomers] = useState<NewCustomer[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const visitsRef = useRef<LocalVisit[]>([]);
  const dateRef = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const sheetRef = useRef<RepDaySheet | null>(null);
  sheetRef.current = sheet;
  activeRef.current = active;

  const setVisits = useCallback(
    (next: LocalVisit[]) => {
      visitsRef.current = next;
      setVisitsState(next);
      if (dateRef.current) void local.set(visitsKey(dateRef.current), next);
    },
    [local],
  );

  // The store's today, from its settings (time zone and the hour the business day turns over)
  const readDate = useCallback(async () => {
    const [settings] = (await store.readSet('settings')) as unknown as SettingsRow[];
    const date = settings
      ? businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff)
      : new Date(pos.now()).toISOString().slice(0, 10);
    dateRef.current = date;
    setBusinessDate(date);
    return date;
  }, [store, pos]);

  // The pulled sets: they are on the device, so the list opens offline (read again after each sync cycle)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [routes, routeCustomers, reasons, orders] = await Promise.all([
        store.readSet('routes'),
        store.readSet('route_customers'),
        store.readSet('no_sale_reasons'),
        store.readSet('sales_orders'),
      ]);
      if (!alive) return;
      setSets({
        routes: routes as unknown as RoutePullRow[],
        routeCustomers: routeCustomers as unknown as RouteCustomerPullRow[],
        reasons: (reasons as unknown as NoSaleReasonPullRow[]).filter((r) => r.isActive),
        orders: orders as unknown as SalesOrderPullRow[],
      });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [store, sync]);

  // The visits kept for today, the customers this phone added, and the orders still waiting to leave
  useEffect(() => {
    let alive = true;
    void (async () => {
      const date = await readDate();
      const [kept, added, queue] = await Promise.all([
        local.get<LocalVisit[]>(visitsKey(date)),
        local.get<NewCustomer[]>(NEW_CUSTOMERS_KEY),
        local.get<QueuedOrder[]>(ORDER_QUEUE_KEY),
      ]);
      if (!alive) return;
      visitsRef.current = kept ?? [];
      setVisitsState(kept ?? []);
      setNewCustomers(added ?? []);
      setPendingOrders(queue?.length ?? 0);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [local, readDate]);

  const refresh = useCallback(async () => {
    const token = device.token;
    const cached = await local.get<{ sheet: RepDaySheet; at: number }>(SHEET_KEY);
    if (cached && !sheetRef.current) {
      setSheet(cached.sheet);
      setSheetAt(cached.at);
      setSheetState('cached');
    }
    if (!token || !pos.online()) {
      if (!cached) setSheetState('none');
      return;
    }
    const answer = await fetchRepDay(token, pos.fetch);
    if (answer.kind === 'ok') {
      const at = pos.now();
      setSheet(answer.body);
      setSheetAt(at);
      setSheetState('fresh');
      void local.set(SHEET_KEY, { sheet: answer.body, at });
      // A phone that lost its data gets today's visits back
      if (answer.body.visits.length > 0 && dateRef.current === answer.body.businessDate)
        setVisits(mergeServerVisits(visitsRef.current, answer.body.visits));
    } else if (answer.kind === 'refused') {
      setSheetState('forbidden');
    } else if (!cached) {
      setSheetState('none');
    }
  }, [device.token, local, pos, setVisits]);

  useEffect(() => {
    void refresh();
    // only when the phone starts: the screens ask for a new one with `refresh`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visits leave when the server can be reached
  const sending = useRef(false);
  useEffect(() => {
    const token = device.token;
    const date = dateRef.current;
    if (!token || !date || sending.current || !pos.online()) return;
    const unsent = visits.filter((v) => !v.sent && (v.leftAt !== null || !isEmptyVisit(v)));
    if (unsent.length === 0) return;
    sending.current = true;
    void (async () => {
      let current = visitsRef.current;
      for (const v of unsent) {
        const report: VisitReport = {
          id: v.id,
          businessDate: date,
          customerId: v.customerId,
          routeId: v.routeId,
          offRoute: v.offRoute,
          arrivedAt: v.arrivedAt,
          leftAt: v.leftAt,
          lat: v.lat ?? null,
          lng: v.lng ?? null,
          outcome: primaryOutcome(v.results),
          noSaleReasonId: v.noSaleReasonId,
          docIds: v.docIds,
          note: v.note,
        };
        const answer = await postVisit(report, token, pos.fetch);
        // No answer: try again later. A refusal will not change, so it is marked sent and left
        if (answer.kind === 'network') break;
        current = current.map((c) => (c.id === v.id && !c.sent ? { ...c, sent: true } : c));
      }
      setVisits(current);
    })().finally(() => {
      sending.current = false;
    });
  }, [visits, device.token, pos, setVisits]);

  // Orders taken while the server could not be reached leave once it can
  const flushOrders = useCallback(async () => {
    const token = device.token;
    if (!token || !pos.online()) return;
    const queue = (await local.get<QueuedOrder[]>(ORDER_QUEUE_KEY)) ?? [];
    if (queue.length === 0) return;
    const left: QueuedOrder[] = [];
    for (const order of queue) {
      const answer = await postOrder(order, token, pos.fetch);
      if (answer.kind === 'network') left.push(order);
    }
    await local.set(ORDER_QUEUE_KEY, left);
    setPendingOrders(left.length);
  }, [device.token, local, pos]);
  useEffect(() => {
    void flushOrders();
  }, [flushOrders, sync]);

  const routeOfCustomer = useCallback(
    (customerId: string) => {
      const stop = dayList(
        sets.routes,
        sets.routeCustomers,
        dateRef.current ?? '1970-01-01',
        visitsRef.current,
      ).stops.find((s) => s.customerId === customerId);
      return { routeId: stop?.routeId ?? null, offRoute: !stop };
    },
    [sets.routes, sets.routeCustomers],
  );

  const record = useCallback(
    (
      customerId: string,
      result: VisitResult,
      docId: string | null,
      extra: { noSaleReasonId?: string | null; note?: string | null } = {},
    ) => {
      setVisits(
        withResult(visitsRef.current, {
          customerId,
          result,
          docId,
          at: new Date(pos.now()).toISOString(),
          newId: uuidv7,
          ...routeOfCustomer(customerId),
          ...extra,
        }),
      );
    },
    [pos, routeOfCustomer, setVisits],
  );

  const noteDocument = useCallback(
    (type: string, payload: Record<string, unknown>, entry: OutboxEntry) => {
      if (type === 'customer') {
        const made: NewCustomer = {
          id: entry.doc.id,
          name: String(payload.name ?? ''),
          phone: typeof payload.phone === 'string' ? payload.phone : null,
          at: pos.now(),
        };
        setNewCustomers((list) => {
          const next = [...list.filter((c) => c.id !== made.id), made];
          void local.set(NEW_CUSTOMERS_KEY, next);
          return next;
        });
        return;
      }
      const result = resultOf(type);
      if (!result) return;
      const customerId = customerOfDocument(type, payload) ?? activeRef.current;
      if (customerId) record(customerId, result, entry.doc.id);
    },
    [local, pos, record],
  );

  const enter = useCallback(
    (customerId: string, note: string | null = null) => {
      setActive(customerId);
      activeRef.current = customerId;
      setVisits(
        arriving(visitsRef.current, {
          customerId,
          at: new Date(pos.now()).toISOString(),
          newId: uuidv7,
          ...routeOfCustomer(customerId),
          note,
        }),
      );
    },
    [pos, routeOfCustomer, setVisits],
  );
  const leave = useCallback(() => {
    const id = activeRef.current;
    setActive(null);
    activeRef.current = null;
    if (id) setVisits(leaving(visitsRef.current, id, new Date(pos.now()).toISOString()));
  }, [pos, setVisits]);

  const noSale = useCallback(
    (customerId: string, reasonId: string, note: string | null) =>
      record(customerId, 'no_sale', null, { noSaleReasonId: reasonId, note }),
    [record],
  );

  const submitOrder = useCallback<RepState['submitOrder']>(
    async (input) => {
      const order: QueuedOrder = { ...input, id: input.id ?? uuidv7() };
      const token = device.token;
      if (token && pos.online()) {
        const answer = await postOrder(order, token, pos.fetch);
        if (answer.kind === 'ok') {
          record(order.customerId, 'order', order.id);
          return { kind: 'sent', number: answer.body.number };
        }
        if (answer.kind === 'refused') return { kind: 'refused', message: answer.message };
      }
      const queue = (await local.get<QueuedOrder[]>(ORDER_QUEUE_KEY)) ?? [];
      const next = [...queue.filter((q) => q.id !== order.id), order];
      await local.set(ORDER_QUEUE_KEY, next);
      setPendingOrders(next.length);
      record(order.customerId, 'order', order.id);
      return { kind: 'queued' };
    },
    [device.token, local, pos, record],
  );

  const withLocalCustomers = useCallback(
    (customers: readonly CustomerRow[]): CustomerRow[] => {
      const known = new Set(customers.map((c) => c.id));
      const added = newCustomers
        .filter((c) => !known.has(c.id))
        .map((c): CustomerRow => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          creditLimitMinor: 0,
          priceTier: 'retail',
          loyaltyPoints: 0,
          archived: false,
          version: 0,
          approvalStatus: 'pending',
        }));
      return [...customers, ...added];
    },
    [newCustomers],
  );

  const list = useMemo(
    () => (businessDate ? dayList(sets.routes, sets.routeCustomers, businessDate, visits) : EMPTY_LIST),
    [sets.routes, sets.routeCustomers, businessDate, visits],
  );

  return {
    businessDate,
    sheet,
    sheetAt,
    sheetState,
    ...sets,
    newCustomers,
    visits,
    list,
    activeCustomerId: active,
    pendingOrders,
    refresh,
    enter,
    leave,
    noSale,
    noteDocument,
    submitOrder,
    withLocalCustomers,
  };
}
