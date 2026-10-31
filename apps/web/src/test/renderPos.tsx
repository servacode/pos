import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { memoryLocal, type LocalStore } from '../offline/local';
import type { CatalogSets } from '../pos/catalog';
import { PosSession } from '../pos/PosApp';
import { saveWith, type PosServices } from '../pos/services';
import { ids, linkedDevice, memoryStore, PINS, posSets, staffServer } from './pos';
// Loaded up front so no test waits on a lazy chunk.
import '../pos/CashierApp';
import '../pos/staff/StaffSignIn';
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

export const SHIFT_ID = '0192a000-0000-7000-8000-00000000ffff';

export async function openShift(local: LocalStore, userId = ids.samer) {
  await local.set(`shift:${userId}`, {
    key: `shift:${userId}`,
    id: SHIFT_ID,
    number: 'SFT-001-002-0000001',
    openedBy: userId,
    openedByName: 'سامر',
    openedAt: Date.now(),
    mode: 'per_cashier',
    opening: [{ currency: 'SYP', amountMinor: 0, denominations: null }],
  });
}

/** Signed in as سامر (cashier) with an open shift, on the sale screen. */
export async function saleScreen(options: RenderPosOptions = {}) {
  const local = options.local ?? memoryLocal();
  await openShift(local);
  const pos = renderPos({ ...options, local });
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await pos.user.click(within(list).getByRole('button', { name: /سامر/ }));
  await pos.user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
  return pos;
}

/** What a scanner does: the whole code fast, then Enter, wherever the focus is. */
export async function scan(user: ReturnType<typeof renderPos>['user'], code: string) {
  (document.activeElement as HTMLElement | null)?.blur();
  await user.keyboard(`${code}{Enter}`);
}
