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
  TextField,
  type Icon,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { holdsAny, type AccessRule } from './access';

/** The page title row: the path above, the title with its icon and line, the page's actions. */
export function PageHead({
  crumbs,
  title,
  subtitle,
  actions,
  icon,
}: {
  crumbs?: readonly string[];
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: Icon;
}) {
  return (
    <PageHeader
      className="mb-0 print:hidden"
      title={title}
      description={subtitle}
      icon={icon}
      eyebrow={
        crumbs && crumbs.length > 0 ? (
          <nav aria-label="المسار" className="text-ink-muted">
            {crumbs.join(' / ')}
          </nav>
        ) : undefined
      }
      actions={actions}
    />
  );
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
      <title>{`${title} · Serva POS`}</title>
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
export function branchChoices(me: MeResponse): { all: boolean; branches: MeResponse['branches'] } {
  const tied = me.user.roles.map((role) => role.branchId);
  const all = tied.length === 0 || tied.includes(null);
  const branches = all ? me.branches : me.branches.filter((branch) => tied.includes(branch.id));
  return { all: all && branches.length > 1, branches };
}

export function defaultBranch(me: MeResponse): string | null {
  const { all, branches } = branchChoices(me);
  return all ? null : (branches[0]?.id ?? null);
}

export function BranchSelect({
  me,
  value,
  onChange,
}: {
  me: MeResponse;
  value: string | null;
  onChange: (branchId: string | null) => void;
}) {
  const { all, branches } = branchChoices(me);
  return (
    <Select
      label="الفرع"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      className="min-w-48"
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
    <TextField
      label={label}
      type="date"
      value={value}
      max={max}
      dir="ltr"
      onChange={(event) => {
        if (event.target.value) onChange(event.target.value);
      }}
      className="min-w-44"
    />
  );
}

/** A card with a title (and optionally an icon and a line under it), for a report's sections. */
export function Section({
  title,
  action,
  children,
  className,
  icon: SectionIcon,
  description,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: Icon;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <Card className="flex h-full flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {SectionIcon ? (
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink"
              >
                <SectionIcon />
              </span>
            ) : null}
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={id} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
            </div>
          </div>
          {action}
        </div>
        {children}
      </Card>
    </section>
  );
}
