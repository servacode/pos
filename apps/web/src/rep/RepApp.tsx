import { lazy, Suspense, useEffect, useMemo } from 'react';
import { FullScreenLoader } from '@serva/ui';
import { deviceStore } from '../offline/database';
import { dexieLocal } from '../offline/local';
import { useDevice } from '../offline/useDevice';
import { PosSession } from '../pos/PosApp';
import { saveWith, type PosServices } from '../pos/services';
import { isWeakConnection, startConnectionProbe } from '../pos/useOnline';
import { RepProvider, useRepState } from './state';

// Linking runs once per device, asking for this kind
const DeviceLink = lazy(() => import('../pos/link/DeviceLink').then((m) => ({ default: m.DeviceLink })));

/**
 * `/rep`: the rep's phone (المندوبون والتوزيع, docs/specs/32-sales-reps.md §وضع المندوب). A device of kind
 * `rep_phone` is linked to its van and opens here (`/link?kind=rep_phone`). After the staff sign-in
 * it is the till's own session (the same cart, payment, receipt, return and shift engines, with the
 * van as the branch, so a sale moves van stock) with the rep's day as its home (RepHome).
 *
 * It does not use hall/DeviceGate: sharing it with the kitchen and waiter screens moves modules
 * between chunks and puts the admin chunk over its budget.
 */
export function RepApp() {
  const { loading, device, persisted, sync, reload, engineSave } = useDevice();
  useEffect(() => (import.meta.env.MODE === 'test' ? undefined : startConnectionProbe()), []);
  // The device's own state is made once per device: a new one on every sync cycle would re-read the shift under the screens
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
      <title>وضع المندوب · SERFA</title>
      {loading ? (
        <FullScreenLoader />
      ) : services?.device.token ? (
        <RepSession services={services} persisted={persisted} />
      ) : (
        <main className="grid min-h-dvh place-items-center bg-canvas p-4">
          <Suspense fallback={null}>
            <DeviceLink kind="rep_phone" onLinked={reload} />
          </Suspense>
        </main>
      )}
    </>
  );
}

/** The rep's state (the day sheet, the visits, the orders waiting to leave) around the till's own session */
export function RepSession({ services, persisted }: { services: PosServices; persisted: boolean | null }) {
  const rep = useRepState(services);
  // Every document this phone saves is also noted against the customer's visit
  const observed = useMemo<PosServices>(
    () => ({
      ...services,
      save: async (input) => {
        const entry = await services.save(input);
        rep.noteDocument(input.type, input.payload, entry);
        return entry;
      },
    }),
    [services, rep],
  );
  return (
    <RepProvider value={rep}>
      <PosSession services={observed} persisted={persisted} />
    </RepProvider>
  );
}
