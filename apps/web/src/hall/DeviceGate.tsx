import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DeviceKind } from '@serva/core';
import type { DeviceRecord } from '@serva/sync/client';
import { FullScreenLoader } from '@serva/ui';
import { deviceStore } from '../offline/database';
import { loadDevice } from '../offline/device';

const DeviceLink = lazy(() => import('../pos/link/DeviceLink').then((m) => ({ default: m.DeviceLink })));

/** A device that has its token: the kitchen and waiter screens need nothing else of the device. */
export type LinkedDevice = DeviceRecord & { token: string };

/**
 * The kitchen and waiter screens run on a device of their own kind (03 › وضع النادل). Until the device
 * is linked it shows the same linking steps as the till, asking for this kind; after that it opens
 * the screen with the device's token. Nothing is stored here: the token lives in the device database.
 */
export function DeviceGate({
  kind,
  children,
  load = () => loadDevice(deviceStore()),
}: {
  kind: DeviceKind;
  children: (device: LinkedDevice) => ReactNode;
  /** Reads the device record; tests pass their own */
  load?: () => Promise<DeviceRecord | null>;
}) {
  const [state, setState] = useState<{ loading: boolean; device: DeviceRecord | null }>({
    loading: true,
    device: null,
  });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let alive = true;
    void load().then(
      (device) => alive && setState({ loading: false, device }),
      () => alive && setState({ loading: false, device: null }),
    );
    return () => {
      alive = false;
    };
    // `load` is a fresh arrow each render: the device is read on arrival and after linking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  if (state.loading) return <FullScreenLoader />;
  const device = state.device;
  if (device?.token) return <>{children({ ...device, token: device.token })}</>;
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <Suspense fallback={null}>
        <DeviceLink kind={kind} onLinked={reload} />
      </Suspense>
    </main>
  );
}
