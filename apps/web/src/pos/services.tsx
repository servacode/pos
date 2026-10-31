import { createContext, useContext, type ReactNode } from 'react';
import { documentPayloadRejection, uuidv7 } from '@serva/sync';
import type { DeviceRecord, NewDocument, SyncState, SyncStore } from '@serva/sync/client';
import type { OutboxEntry } from '@serva/sync';
import type { LocalStore } from '../offline/local';

/**
 * What the cashier screens need from the device, in one place so tests can hand in fakes: the
 * sync store (pulled sets, outbox), the app's local state, the device record, and `save`, which
 * checks a document against its contract and puts it in the outbox with its number.
 */
export interface PosServices {
  store: SyncStore;
  local: LocalStore;
  device: DeviceRecord;
  /** Checked with the contract's schema first: a malformed document is never saved */
  save: (input: NewDocument) => Promise<OutboxEntry>;
  online: () => boolean;
  now: () => number;
  /** The sync loops' last state, for the status bar; null before the first cycle */
  sync: SyncState | null;
  fetch?: typeof fetch;
}

export class InvalidDocumentError extends Error {
  override readonly name = 'InvalidDocumentError';
}

/** `save` for a store, with or without the sync loops (a device that is only named has none). */
export function saveWith(
  store: SyncStore,
  engineSave: ((input: NewDocument) => Promise<OutboxEntry>) | null,
  now: () => number = Date.now,
): (input: NewDocument) => Promise<OutboxEntry> {
  return async (input) => {
    const rejection = documentPayloadRejection({ type: input.type, payload: input.payload });
    if (rejection) {
      throw new InvalidDocumentError(
        `${input.type} payload: ${rejection.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      );
    }
    if (engineSave) return engineSave(input);
    return store.createDocument(input, { now: now(), newId: uuidv7 });
  };
}

const PosContext = createContext<PosServices | null>(null);

export function PosProvider({ services, children }: { services: PosServices; children: ReactNode }) {
  return <PosContext value={services}>{children}</PosContext>;
}

export function usePos(): PosServices {
  const services = useContext(PosContext);
  if (!services) throw new Error('usePos needs a <PosProvider> above it');
  return services;
}
