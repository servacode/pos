import type { MeResponse } from '@serva/core';
import { holdsAny } from '../admin/reports/access';
import { SERIAL_SECTORS, storeSells } from '../lib/sectors';

/**
 * Whether the home page has the serial-number drift to load: a store that tracks numbers, for someone who can open
 * the page. The drift is one row of «تحتاج انتباهك» (it is counted there), not a card of its own.
 */
export const seesSerialAttention = (me: Pick<MeResponse, 'user' | 'settings' | 'tenant'>) =>
  storeSells(me.tenant.sectors, SERIAL_SECTORS) &&
  holdsAny(me as MeResponse, ['catalog.manage', 'inventory.adjust']);
