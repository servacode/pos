import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { memoryLocal, type LocalStore } from '../offline/local';
import type { CatalogSets } from '../pos/catalog';
import { PosSession } from '../pos/PosApp';
import { saveWith, type PosServices } from '../pos/services';
import { linkedDevice, memoryStore, posSets, staffServer } from './pos';
// Loaded up front so no test waits on a lazy chunk.
import '../pos/CashierApp';
import '../pos/pay/PaymentPanel';
import '../pos/shift/ShiftScreens';

export interface RenderPosOptions {
  sets?: CatalogSets;
  online?: boolean;
  local?: LocalStore;
  fetch?: typeof fetch;
  now?: () => number;
}

/** The cashier screens over an in-memory sync store and local state (no IndexedDB, no network). */
export function renderPos(options: RenderPosOptions = {}) {
  const sets = options.sets ?? posSets();
  const { store, outbox } = memoryStore(linkedDevice, sets);
  const local = options.local ?? memoryLocal();
  let online = options.online ?? true;
  const fetchFn = options.fetch ?? (staffServer(sets) as unknown as typeof fetch);
  const now = options.now ?? Date.now;
  const services: PosServices = {
    store,
    local,
    device: linkedDevice,
    save: saveWith(store, null, now),
    online: () => online,
    now,
    sync: null,
    fetch: fetchFn,
  };
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter>
      <PosSession services={services} persisted={true} />
    </MemoryRouter>,
  );
  return {
    user,
    view,
    store,
    outbox,
    local,
    services,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}
