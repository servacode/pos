import { Link } from 'react-router';
import type { MeResponse } from '@serva/core';
import { Card, NextIcon, SerialIcon, WarningIcon } from '@serva/ui';
import { getSerialDrift } from '../admin/purchases/api';
import { holdsAny } from '../admin/reports/access';
import { useReport } from '../admin/reports/useReport';
import { SERIAL_SECTORS, storeSells } from '../lib/sectors';

/** Whether the home page has this row to load: a store that tracks numbers, for someone who can open the page */
export const seesSerialAttention = (me: Pick<MeResponse, 'user' | 'settings' | 'tenant'>) =>
  storeSells(me.tenant.sectors, SERIAL_SECTORS) &&
  holdsAny(me as MeResponse, ['catalog.manage', 'inventory.adjust']);

/** «أرقام لا تطابق المخزون» on the home page: shown only when the drift list has something (round 64) */
export function SerialAttention({ me }: { me: MeResponse }) {
  const drift = useReport(seesSerialAttention(me) ? 'home:serial-drift' : null, getSerialDrift);
  const n = drift.data?.items.length ?? 0;
  if (n === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <SerialIcon size={20} />
        الأرقام التسلسلية
      </h2>
      <Link
        to="/serials"
        className="flex min-h-14 items-center gap-3 rounded-card bg-warning-soft px-3 font-semibold text-warning-ink transition-opacity duration-120 hover:opacity-90"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface/70">
          <WarningIcon />
        </span>
        <span className="min-w-0 flex-1">
          {n === 1 ? 'صنف أرقامه لا تطابق المخزون' : 'أصناف أرقامها لا تطابق المخزون'}
        </span>
        <span className="num text-lg font-bold">{drift.data?.truncated ? `${n}+` : n}</span>
        <NextIcon size={16} />
      </Link>
    </Card>
  );
}
