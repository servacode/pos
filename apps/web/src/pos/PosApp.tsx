import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { CashierShell, DigitsProvider } from '@serva/ui';
import { deviceStore } from '../offline/database';
import { dexieLocal } from '../offline/local';
import { useDevice } from '../offline/useDevice';
import { loadCatalog, type Catalog } from './catalog';
import { PosProvider, saveWith, type PosServices } from './services';
import { staffRoster, type StaffSession } from './staff/staff';
import { StatusBar, type OutboxStatus } from './StatusBar';
import { useOnline } from './useOnline';

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
  const online = useOnline();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<StaffSession | null>(null);
  const [tick, setTick] = useState(0);

  // Read the pulled sets on start and again after every sync cycle (new prices, new staff).
  useEffect(() => {
    let alive = true;
    void loadCatalog(services.store, services.now()).then(
      (loaded) => alive && setCatalog(loaded),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [services]);

  const pos = useMemo<PosServices>(
    () => ({
      ...services,
      save: async (input) => {
        const entry = await services.save(input);
        setTick((t) => t + 1);
        return entry;
      },
    }),
    [services],
  );
  const outbox = useOutboxStatus(pos, tick);
  const staff = useMemo(
    () => (catalog ? staffRoster(catalog.staff, services.device.branchCode) : []),
    [catalog, services.device.branchCode],
  );
  const signOut = useCallback(() => setSession(null), []);
  const digits = catalog?.settings?.numberFormat ?? 'latn';

  useEffect(() => {
    if (staff.length > 0) preloadCashier();
  }, [staff.length]);

  return (
    <PosProvider services={pos}>
      <DigitsProvider digits={digits}>
        {session && catalog ? (
          <Suspense fallback={null}>
            <CashierApp
              session={session}
              catalog={catalog}
              persisted={persisted}
              online={online}
              outbox={outbox}
              onSignOut={signOut}
            />
          </Suspense>
        ) : (
          <CashierShell
            statusBar={
              <StatusBar device={services.device} persisted={persisted} online={online} outbox={outbox} />
            }
            mainClassName="grid place-items-center p-6 lg:px-14 lg:py-8"
          >
            {catalog ? (
              <Suspense fallback={null}>
                <StaffSignIn staff={staff} onSignedIn={setSession} />
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

  const local = useMemo(() => (device ? dexieLocal(deviceStore().db) : null), [device]);
  const services = useMemo<PosServices | null>(() => {
    if (!device || !local) return null;
    const store = deviceStore();
    return {
      store,
      local,
      device,
      save: saveWith(store, engineSave),
      online: () => globalThis.navigator?.onLine ?? true,
      now: Date.now,
      sync,
    };
  }, [device, local, engineSave, sync]);

  return (
    <>
      <title>الكاشير · Serva POS</title>
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
