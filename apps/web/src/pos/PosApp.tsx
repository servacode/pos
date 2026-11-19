import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { CashierShell, DigitsProvider } from '@serva/ui';
import { deviceStore } from '../offline/database';
import { dexieLocal } from '../offline/local';
import { useDevice } from '../offline/useDevice';
import { loadCatalog, type Catalog } from './catalog';
import { withPendingProducts } from './sale/localProducts';
import { PosProvider, saveWith, type PosServices } from './services';
import {
  DEFAULT_IDLE_MINUTES,
  forgetSession,
  keepSession,
  restoreSession,
  touchSession,
} from './staff/persist';
import { staffRoster, type StaffSession } from './staff/staff';
import { TillBoundary } from './chunks';
import { useLocalStock } from './localStock';
import { StatusBar, type OutboxStatus } from './StatusBar';
import { isWeakConnection, startConnectionProbe, useOnline, useReachable } from './useOnline';

// Linking runs once per device: its screens load only on a device that is not linked yet.
const DeviceLink = lazy(() => import('./link/DeviceLink').then((m) => ({ default: m.DeviceLink })));
// Who works and their code: loaded as soon as the device is known (a local file, no network).
const StaffSignIn = lazy(() => import('./staff/StaffSignIn').then((m) => ({ default: m.StaffSignIn })));
// The sale screen and everything after the sign-in.
const CashierApp = lazy(() => import('./CashierApp').then((m) => ({ default: m.CashierApp })));

/** Starts loading the sale screen while the cashier types the code, so it opens at once. */
export function preloadCashier(): void {
  void import('./CashierApp');
}

/** The outbox's count and last send, read again whenever the loops report or a document is saved. */
export function useOutboxStatus(pos: PosServices, tick: number): OutboxStatus | null {
  const [status, setStatus] = useState<OutboxStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([pos.store.countPending(), pos.store.getMeta()]).then(
      ([pending, meta]) => alive && setStatus({ pending, lastSentAt: meta.lastPushAt }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pos.store, pos.sync, tick]);
  return status;
}

/**
 * Who works on this device: the sign-in, then the sale screen. Everything comes from the device
 * database through `services`, so it opens the same with or without internet; tests pass fakes.
 */
export function PosSession({ services, persisted }: { services: PosServices; persisted: boolean | null }) {
  const online = useReachable();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<StaffSession | null>(null);
  const [tick, setTick] = useState(0);
  // A product made at the till offline joins the catalog at once (sale/localProducts.ts)
  const [productsTick, setProductsTick] = useState(0);

  // Read the pulled sets on start and again after every sync cycle (new prices, new staff).
  useEffect(() => {
    let alive = true;
    void loadCatalog(services.store, services.now(), (sets) =>
      withPendingProducts(services.local, services.store, sets),
    ).then(
      (loaded) => alive && setCatalog(loaded),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [services, productsTick]);

  const pos = useMemo<PosServices>(
    () => ({
      ...services,
      save: async (input) => {
        const entry = await services.save(input);
        if (input.type === 'temp_item') setProductsTick((t) => t + 1);
        setTick((t) => t + 1);
        return entry;
      },
    }),
    [services],
  );
  const outbox = useOutboxStatus(pos, tick);
  // The tiles show what is left after this device's own sales, even before the server counts them
  const shownCatalog = useLocalStock(pos, catalog, tick);
  const staff = useMemo(
    () => (catalog ? staffRoster(catalog.staff, services.device.branchCode) : []),
    [catalog, services.device.branchCode],
  );
  const deviceKey = services.device.deviceId ?? services.device.deviceCode ?? '';
  const [lockNote, setLockNote] = useState<string | null>(null);
  const signedIn = useCallback(
    (next: StaffSession) => {
      keepSession(
        next,
        staff.find((m) => m.id === next.userId),
        deviceKey,
        services.now(),
      );
      setLockNote(null);
      setSession(next);
    },
    [staff, deviceKey, services],
  );
  const signOut = useCallback((note?: string) => {
    forgetSession();
    setLockNote(note ?? null);
    setSession(null);
  }, []);
  // A reload keeps the person signed in for the idle window, with no code kept (staff/persist.ts)
  const [restored, setRestored] = useState(false);
  const idleMinutes = catalog?.settings?.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  useEffect(() => {
    if (restored || !catalog || staff.length === 0) return;
    setRestored(true);
    const back = restoreSession(staff, deviceKey, services.now(), idleMinutes);
    if (back) setSession((now) => now ?? back);
  }, [restored, catalog, staff, deviceKey, services, idleMinutes]);
  useEffect(() => {
    if (!session) return;
    let last = 0;
    const touch = () => {
      const t = services.now();
      if (t - last < 5_000) return;
      last = t;
      touchSession(t);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const type of events) window.addEventListener(type, touch, { capture: true, passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, touch, { capture: true });
    };
  }, [session, services]);
  const digits = catalog?.settings?.numberFormat ?? 'latn';

  useEffect(() => {
    if (staff.length > 0) preloadCashier();
  }, [staff.length]);

  return (
    <PosProvider services={pos}>
      <DigitsProvider digits={digits}>
        {session && shownCatalog ? (
          <TillBoundary>
            <Suspense fallback={null}>
              <CashierApp
                session={session}
                catalog={shownCatalog}
                persisted={persisted}
                online={online}
                outbox={outbox}
                onSignOut={signOut}
              />
            </Suspense>
          </TillBoundary>
        ) : (
          <CashierShell
            statusBar={
              <StatusBar device={services.device} persisted={persisted} online={online} outbox={outbox} />
            }
            mainClassName="grid place-items-center p-6 lg:px-14 lg:py-8"
          >
            {catalog ? (
              <Suspense fallback={null}>
                <div className="flex w-full flex-col items-center">
                  {lockNote ? (
                    <p
                      role="status"
                      className="mb-4 rounded-control border border-line bg-surface-muted px-4 py-2 text-center text-sm text-ink"
                    >
                      {lockNote}
                    </p>
                  ) : null}
                  <StaffSignIn staff={staff} onSignedIn={signedIn} />
                </div>
              </Suspense>
            ) : null}
          </CashierShell>
        )}
      </DigitsProvider>
    </PosProvider>
  );
}

/**
 * The cashier app. It boots only from what this device keeps locally (the device database) and
 * asks who works and their code: no session refresh and no request before that, so it opens the
 * same with or without internet. An activated device then syncs in the background.
 */
export function PosApp() {
  const { loading, device, persisted, sync, reload, engineSave } = useDevice();
  const online = useOnline();
  useEffect(() => (import.meta.env.MODE === 'test' ? undefined : startConnectionProbe()), []);

  const local = useMemo(() => (device ? dexieLocal(deviceStore().db) : null), [device]);
  const services = useMemo<PosServices | null>(() => {
    if (!device || !local) return null;
    const store = deviceStore();
    return {
      store,
      local,
      device,
      save: saveWith(store, engineSave),
      online: () => (globalThis.navigator?.onLine ?? true) && !isWeakConnection(),
      now: Date.now,
      sync,
    };
  }, [device, local, engineSave, sync]);

  return (
    <>
      <title>الكاشير · SERFA</title>
      <Routes>
        <Route
          index
          element={
            loading ? null : services ? (
              <PosSession services={services} persisted={persisted} />
            ) : (
              <CashierShell
                statusBar={<StatusBar device={null} persisted={persisted} online={online} />}
                mainClassName="flex justify-center p-6 lg:px-14 lg:py-8"
              >
                <Suspense fallback={null}>
                  <DeviceLink onLinked={reload} />
                </Suspense>
              </CashierShell>
            )
          }
        />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </>
  );
}
