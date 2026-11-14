import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { daysBetween, type MeResponse } from '@serva/core';
import { Card, CalendarIcon, cn, NextIcon, SerialIcon, WarningIcon } from '@serva/ui';
import { listContracts, listRentals } from '../admin/contracts/api';
import { holdsAny } from '../admin/reports/access';
import { useReport } from '../admin/reports/useReport';
import { RENTAL_SECTORS, storeSells } from '../lib/sectors';

const TONES = {
  danger: 'bg-danger-soft text-danger-ink',
  warning: 'bg-warning-soft text-warning-ink',
} as const;

function Row({
  to,
  count,
  tone,
  icon,
  children,
}: {
  to: string;
  count: number;
  tone: keyof typeof TONES;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-card px-3 font-semibold transition-opacity duration-120 hover:opacity-90',
          TONES[tone],
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface/70">{icon}</span>
        <span className="min-w-0 flex-1">{children}</span>
        <span className="num text-lg font-bold">{count}</span>
        <NextIcon size={16} />
      </Link>
    </li>
  );
}

/** Whether the home page has these rows to load for this person and store */
export const seesContractAttention = (me: Pick<MeResponse, 'user' | 'settings' | 'tenant'>) =>
  storeSells(me.tenant.sectors, RENTAL_SECTORS);

/**
 * «التأجير والعقود» on the home page (03 › الأدوات الطبية): rentals past the day they were due, the
 * maintenance visits due within 30 days or late, and contracts about to end and ask for renewal. Shown
 * only when there is something, and only to those who may open those screens.
 */
export function ContractAttention({ me, today }: { me: MeResponse; today: string }) {
  const seesRentals = holdsAny(me, ['customers.view']);
  const seesContracts = holdsAny(me, ['catalog.manage']);
  const rentals = useReport(seesRentals ? 'home:rentals' : null, () => listRentals('out'));
  const contracts = useReport(seesContracts ? 'home:contracts' : null, () => listContracts('all'));
  const late = (rentals.data?.items ?? []).filter((r) => r.overdue).length;
  const live = (contracts.data?.items ?? []).filter((c) => c.state === 'active' || c.state === 'ending');
  const visits = live.filter((c) => c.nextVisit !== null && daysBetween(today, c.nextVisit) <= 30).length;
  const renewals = live.filter((c) => c.state === 'ending').length;
  if (late + visits + renewals === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <SerialIcon size={20} />
        التأجير والعقود
      </h2>
      <ul className="flex flex-col gap-2">
        {late > 0 ? (
          <Row to="/rentals" count={late} tone="danger" icon={<WarningIcon />}>
            {late === 1 ? 'جهاز مؤجَّر تأخّر إرجاعه' : 'أجهزة مؤجَّرة تأخّر إرجاعها'}
          </Row>
        ) : null}
        {visits > 0 ? (
          <Row to="/maintenance" count={visits} tone="warning" icon={<CalendarIcon />}>
            {visits === 1 ? 'زيارة صيانة مستحقة' : 'زيارات صيانة مستحقة'}
          </Row>
        ) : null}
        {renewals > 0 ? (
          <Row to="/maintenance" count={renewals} tone="warning" icon={<CalendarIcon />}>
            {renewals === 1 ? 'عقد صيانة يقترب انتهاؤه' : 'عقود صيانة يقترب انتهاؤها'}
          </Row>
        ) : null}
      </ul>
    </Card>
  );
}
