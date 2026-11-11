import type { ReactNode } from 'react';
import { BackIcon, cn, CONTROL_HEIGHT, DeleteIcon, IconButton, Tooltip, useDensity } from '@serva/ui';

/**
 * The arrow between the two ends of a move (from a branch to a branch, or to the supplier), level
 * with the fields beside it: toward the reading end, down on a phone where the fields stack.
 * BackIcon is drawn for a left-to-right page and mirrored in Arabic, so half a turn points it on.
 */
export function WayArrow() {
  const density = useDensity();
  return (
    <span
      aria-hidden="true"
      className={cn('flex items-center justify-center md:mt-6.5', CONTROL_HEIGHT[density])}
    >
      <span className="grid size-9 place-items-center rounded-full border border-line bg-surface-muted text-brand-ink">
        <BackIcon size={20} className="rotate-90 md:rotate-180" />
      </span>
    </span>
  );
}

/**
 * A titled block of a page (هوية 4 › Page anatomy): the section title and a line under it at the
 * start, its toolbar (search, filters) at the end, wrapping under it on a phone.
 */
export function SectionHead({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 max-sm:w-full">{children}</div> : null}
    </div>
  );
}

/**
 * The lines of a document being written (a purchase, a transfer, a return): framed like a
 * DataTable, with its soft column heads from md up. Each field keeps its own full label for screen
 * readers; on a phone a short caption shows above it instead of the heads.
 */
export function LinesTable({
  label,
  head,
  children,
}: {
  label: string;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface">
      {head}
      <ul aria-label={label} className="divide-y divide-line">
        {children}
      </ul>
    </div>
  );
}

/** The column heads of a LinesTable; `className` sets the same grid columns as its rows. */
export function LinesHead({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'hidden items-center gap-x-3 border-b border-line bg-surface-muted/60 px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-ink-subtle md:grid',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A field's short caption: on a phone only (the heads say it from md up), or always. */
export function Caption({ children, always = false }: { children: ReactNode; always?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('mb-1.5 block text-xs font-semibold text-ink-subtle', !always && 'md:hidden')}
    >
      {children}
    </span>
  );
}

/** The bin at the end of a line, named after the line for screen readers. */
export function RemoveLine({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <Tooltip content="احذف السطر">
      <IconButton label={`احذف ${name}`} icon={<DeleteIcon />} onClick={onRemove} />
    </Tooltip>
  );
}
