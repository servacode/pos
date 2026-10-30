import { useEffect, useState } from 'react';
import type { DeviceRecord, SyncState } from '@serva/sync/client';
import { deviceStore } from './database';
import { loadDevice } from './device';
import { checkStorage, startSync } from './sync';

export interface DeviceState {
  loading: boolean;
  device: DeviceRecord | null;
  /** false: the browser may wipe this device's data (red warning); null: unknown or no such API */
  persisted: boolean | null;
  sync: SyncState | null;
}

/**
 * The cashier's view of this device: its record from the device database, whether its storage is
 * persistent, and the sync loops while it is activated. Only local reads happen before the first
 * paint of the login code, so it opens the same with or without internet.
 */
export function useDevice(): DeviceState {
  const [state, setState] = useState<DeviceState>({
    loading: true,
    device: null,
    persisted: null,
    sync: null,
  });

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    const store = deviceStore();
    void loadDevice(store).then((device) => {
      if (!alive) return;
      setState((s) => ({ ...s, loading: false, device }));
      if (!device) return;
      void checkStorage(store).then(
        (storage) => alive && setState((s) => ({ ...s, persisted: storage.persisted })),
        () => undefined,
      );
      const engine = startSync(store, device, (sync) => alive && setState((s) => ({ ...s, sync })));
      stop = engine ? () => engine.stop() : null;
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  return state;
}
