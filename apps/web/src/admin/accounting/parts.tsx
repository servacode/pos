import type { ReactNode } from 'react';
import type { MeResponse } from '@serva/core';
import { Card, cn, CONTROL_HEIGHT, useDensity } from '@serva/ui';
import { BranchSelect, DayField } from '../reports/parts';

/**
 * The period and branch a ledger is read for (هوية 4 › Page anatomy › Toolbar): «من», «إلى» and
 * «الفرع» in one row, and at its end what the period gives (the trial balance's «متوازن»).
 */
export function PeriodBar({
  me,
  today,
  from,
  to,
  branchId,
  onFrom,
  onTo,
  onBranch,
  children,
}: {
  me: MeResponse;
  today: string;
  from: string;
  to: string;
  branchId: string | null;
  onFrom: (day: string) => void;
  onTo: (day: string) => void;
  onBranch: (branchId: string | null) => void;
  /** The period's state, at the end of the row (under it on a phone). */
  children?: ReactNode;
}) {
  const density = useDensity();
  return (
    // One field under another on a phone, side by side from 640 px.
    <Card className="grid gap-4 sm:flex sm:flex-wrap sm:items-end">
      <DayField label="من" value={from} max={to} onChange={onFrom} />
      <DayField label="إلى" value={to} max={today} onChange={onTo} />
      <BranchSelect me={me} value={branchId} onChange={onBranch} />
      {children ? (
        // As tall as the fields beside it, so its words line up with what is typed in them.
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 sm:basis-64 sm:justify-end',
            CONTROL_HEIGHT[density],
          )}
        >
          {children}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * An account as the ledgers write it: its number in equal-width digits, then its name. The space
 * between them stays in the text, so a row reads «1110 الصندوق».
 */
export function AccountName({
  code,
  name,
  strong = false,
  className,
}: {
  code: string;
  name: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('min-w-0', className)}>
      <bdi className="num text-ink-subtle">{code}</bdi>{' '}
      <span className={cn('text-ink', strong && 'font-semibold')}>{name}</span>
    </span>
  );
}
