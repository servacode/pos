import type { ReactNode } from 'react';
import type { MeResponse } from '@serva/core';
import { Alert, Badge, Card, CheckCircleIcon, cn, Skeleton, WarningIcon } from '@serva/ui';
import { dayText } from '../../lib/dates';
import { BranchSelect, DayField } from '../reports/parts';

export function branchName(me: MeResponse, branchId: string | null): string {
  if (!branchId) return 'كل الفروع';
  return me.branches.find((branch) => branch.id === branchId)?.name ?? 'الفرع';
}

/**
 * One line of a statement: a label and its amounts (one, or two when a second date is compared),
 * a total in bold above a rule. The amounts keep a fixed width and the line wraps on a phone.
 */
export function StatementLine({
  label,
  values,
  strong = false,
  indent = false,
  muted = false,
}: {
  label: ReactNode;
  values: ReactNode[];
  strong?: boolean;
  indent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5',
        indent && 'ps-6 text-ink-muted',
        muted && 'text-ink-muted',
        strong && 'border-t border-line pt-2.5 font-bold text-ink',
      )}
      style={{ flexWrap: 'wrap' }}
    >
      <dt style={{ minWidth: '10rem', flex: '1 1 10rem' }}>{label}</dt>
      <dd className="text-ink" style={{ display: 'flex', gap: '1.5rem', marginInlineStart: 'auto' }}>
        {values.map((value, i) => (
          <span key={i} style={{ minWidth: '8.5rem', textAlign: 'end' }}>
            {value}
          </span>
        ))}
      </dd>
    </div>
  );
}

/** The date and branch row of a statement as of one day (the period reports use the ledger's PeriodBar). */
export function DayBar({
  me,
  today,
  label,
  value,
  onChange,
  branchId,
  onBranch,
  children,
}: {
  me: MeResponse;
  today: string;
  label: string;
  value: string;
  onChange: (day: string) => void;
  branchId: string | null;
  onBranch: (branchId: string | null) => void;
  children?: ReactNode;
}) {
  return (
    <Card className="grid gap-4 sm:flex sm:flex-wrap sm:items-end">
      <DayField label={label} value={value} max={today} onChange={onChange} />
      <BranchSelect me={me} value={branchId} onChange={onBranch} />
      {children}
    </Card>
  );
}

/** «مطابق» or «غير مطابق»: the report checked against another figure of the books. */
export function CheckBadge({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return ok ? (
    <Badge tone="success">
      <CheckCircleIcon size={16} />
      {good}
    </Badge>
  ) : (
    <Badge tone="danger">
      <WarningIcon size={16} />
      {bad}
    </Badge>
  );
}

/** What the sheet of A4 starts with: the store, the branch, the report's name and its period. */
export function PrintHead({
  me,
  branchId,
  title,
  period,
}: {
  me: MeResponse;
  branchId: string | null;
  title: string;
  period: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between border-b border-ink pb-2">
      <div>
        <p className="text-lg font-bold">{me.tenant.name}</p>
        <p>{branchName(me, branchId)}</p>
      </div>
      <div className="text-end">
        <p className="text-xl font-bold">{title}</p>
        <p>{period}</p>
      </div>
    </div>
  );
}

/** The card a statement sits in while it loads, fails or has nothing to show. */
export function StatementCard({
  error,
  loading,
  children,
}: {
  error: string | null;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="print:hidden">
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        children
      )}
    </Card>
  );
}

export const period = (from: string, to: string, digits: 'latn' | 'arab') =>
  `من ${dayText(from, digits)} إلى ${dayText(to, digits)}`;
