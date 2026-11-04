import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutboxEntry } from '@serva/sync';
import type { DeviceRecord, NewDocument, SyncEngine, SyncState } from '@serva/sync/client';
import { deviceStore, resetDeviceStore } from './database';
import { loadDevice } from './device';
import { checkStorage, startSync } from './sync';

export interface DeviceState {
  loading: boolean;
  device: DeviceRecord | null;
  /** false: the browser may wipe this device's data (red warning); null: unknown or no such API */
  persisted: boolean | null;
  sync: SyncState | null;
  /** Reads the device again, e.g. once linking saved it, and starts its sync loops. */
  reload: () => void;
  /** The sync loops' save (sent within seconds), or null while the device has no loops */
  engineSave: ((input: NewDocument) => Promise<OutboxEntry>) | null;
  /**
   * A suspended device: stops its loops and deletes everything it keeps, so it opens on the link
   * screen. Called once what it held was sent (or the owner chose to drop it).
   */
  forget: () => Promise<void>;
}

/**
 * The cashier's view of this device: its record from the device database, whether its storage is
 * persistent, and the sync loops while it is activated. Only local reads happen before the first
 * paint of the login code, so it opens the same with or without internet.
 */
export function useDevice(): DeviceState {
  const [state, setState] = useState<Omit<DeviceState, 'reload' | 'engineSave' | 'forget'>>({
    loading: true,
    device: null,
    persisted: null,
    sync: null,
  });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const engine = useRef<SyncEngine | null>(null);
  const [hasEngine, setHasEngine] = useState(false);
  const engineSave = useCallback((input: NewDocument) => engine.current!.save(input), []);

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
      const started = startSync(store, device, (sync) => alive && setState((s) => ({ ...s, sync })));
      engine.current = started;
      setHasEngine(started !== null);
      stop = started ? () => started.stop() : null;
    });
    return () => {
      alive = false;
      stop?.();
      engine.current = null;
      setHasEngine(false);
    };
  }, [generation]);

  const forget = useCallback(async () => {
    engine.current?.stop();
    engine.current = null;
    setHasEngine(false);
    await resetDeviceStore();
    setState({ loading: true, device: null, persisted: null, sync: null });
    reload();
  }, [reload]);

  return { ...state, reload, forget, engineSave: hasEngine ? engineSave : null };
}
