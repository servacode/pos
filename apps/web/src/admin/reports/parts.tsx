import { useId, type ReactNode } from 'react';
import type { MeResponse } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LockIcon,
  PageHeader,
  RetryIcon,
  Select,
  SkeletonText,
} from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { AppShell } from '../../layout/AppShell';
import { holdsAny, type AccessRule } from './access';

/** The page title row: the one h1 with its line, an icon tile and the page's actions (PageHeader). */
export function PageHead({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageHeader className="print:hidden" title={title} description={subtitle} icon={icon} actions={actions} />
  );
}

/** The date, branch and device controls of a report, in one calm card above the numbers. */
export function ReportFilters({ children }: { children: ReactNode }) {
  return <Card className="flex flex-wrap items-end gap-x-4 gap-y-3 !p-4 print:hidden">{children}</Card>;
}

/** A report screen inside the admin shell, or «ليست لك» for whoever lacks its key. */
export function ReportScreen({
  me,
  access,
  title,
  children,
}: {
  me: MeResponse;
  access: AccessRule | ((me: MeResponse) => boolean);
  title: string;
  children: ReactNode;
}) {
  const allowed = typeof access === 'function' ? access(me) : holdsAny(me, access);
  return (
    <AppShell>
      <title>{`${title} · SERVA`}</title>
      {allowed ? (
        <div className="flex flex-col gap-6">{children}</div>
      ) : (
        <Card>
          <EmptyState
            icon={LockIcon}
            title="هذه الشاشة ليست ضمن صلاحياتك."
            description="اطلبها من صاحب المتجر إن احتجتها في عملك."
          />
        </Card>
      )}
    </AppShell>
  );
}

/** Loading and failing states shared by the report screens (tab 14 › الحالات). */
export function ReportLoading({ label }: { label: string }) {
  return (
    <Card aria-busy="true">
      <span className="sr-only">{label}</span>
      <SkeletonText lines={5} />
    </Card>
  );
}

export function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <Alert tone="error">{message}</Alert>
      <Button variant="secondary" icon={<RetryIcon />} onClick={onRetry}>
        أعد المحاولة
      </Button>
    </Card>
  );
}

/** The branches this user may pick: every branch with «كل الفروع» when no role ties them to one. */
export function branchChoices(
  me: MeResponse,
  /** The books' reports offer «كل الفروع» even to a one-branch store: entries with no branch show there */
  alwaysAll = false,
): { all: boolean; branches: MeResponse['branches'] } {
  const tied = me.user.roles.map((role) => role.branchId);
  const all = tied.length === 0 || tied.includes(null);
  const branches = all ? me.branches : me.branches.filter((branch) => tied.includes(branch.id));
  return { all: all && (alwaysAll || branches.length > 1), branches };
}

export function defaultBranch(me: MeResponse, alwaysAll = false): string | null {
  const { all, branches } = branchChoices(me, alwaysAll);
  return all ? null : (branches[0]?.id ?? null);
}

export function BranchSelect({
  me,
  value,
  onChange,
  alwaysAll = false,
  hideLabel = false,
  className,
}: {
  me: MeResponse;
  value: string | null;
  onChange: (branchId: string | null) => void;
  alwaysAll?: boolean;
  /** The label for screen readers only (a bar whose place already says «الفرع») */
  hideLabel?: boolean;
  className?: string;
}) {
  const { all, branches } = branchChoices(me, alwaysAll);
  return (
    <Select
      label="الفرع"
      hideLabel={hideLabel}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      className={className ?? 'min-w-48'}
    >
      {all ? <option value="">كل الفروع</option> : null}
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name}
        </option>
      ))}
    </Select>
  );
}

/** A calendar day field; an emptied field keeps the last day, since every report needs one. */
export function DayField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  max?: string;
}) {
  return (
    <DateField
      label={label}
      value={value}
      max={max}
      required
      onChange={onChange}
      className="min-w-40 max-w-full"
    />
  );
}

/** A card with a title, for a report's sections. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {action}
        </div>
        {children}
      </Card>
    </section>
  );
}
