import { useId, type ComponentProps, type ReactNode } from 'react';
import { BackIcon, Button, CheckIcon, cn, CONTROL_HEIGHT, IconChip, useDensity } from '@serva/ui';

/*
 * The parts every cashier screen around the sale shares (هوية 4 › الكاشير): the screen's head, the
 * big touch choices, and the «done» card. One look for the shift, the drawer, returns, payments
 * from a customer, gift vouchers, alterations and the printer.
 */

/**
 * The head of a screen beside the sale: back to the sale at the start, the screen's picture in a
 * soft square, its title and one line under it, and anything of its own at the end.
 */
export function FlowHeader({
  title,
  description,
  icon,
  onBack,
  backLabel = 'ارجع للبيع',
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Shows the back button; the screen has none when there is nowhere to go back to. */
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {onBack ? (
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          {backLabel}
        </Button>
      ) : null}
      <div className="flex min-w-64 flex-1 items-center gap-3.5">
        {icon ? <IconChip size="lg">{icon}</IconChip> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {description ? <p className="text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The round mark at the end of a choice: empty, then the brand with a check once chosen. */
function ChoiceMark({ group }: { group: 'option' | 'chip' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-line-control bg-surface text-on-brand transition-colors duration-120 ease-standard',
        group === 'option'
          ? 'size-5 group-aria-pressed/option:border-brand group-aria-pressed/option:bg-brand'
          : 'size-4 group-aria-pressed/chip:border-brand group-aria-pressed/chip:bg-brand',
      )}
    >
      <CheckIcon
        size={16}
        strokeWidth={3}
        className={cn(
          'opacity-0 transition-opacity duration-120 ease-standard',
          group === 'option'
            ? 'size-3.5 group-aria-pressed/option:opacity-100'
            : 'size-3 group-aria-pressed/chip:opacity-100',
        )}
      />
    </span>
  );
}

export interface OptionTileProps extends Omit<ComponentProps<'button'>, 'title'> {
  selected: boolean;
  /** A picture at the start, in a soft square that takes the brand once chosen. */
  icon?: ReactNode;
  title: ReactNode;
  /** One line under the title. It is part of the button's name. */
  description?: ReactNode;
}

/**
 * One of a few big choices on the till (the kind of a drawer movement, how money goes back, the
 * printer): a card that is a pressed button, drawn like the ChoiceCard of هوية 4. Picked, it takes
 * the brand border, a soft halo and tint, and a check at the end.
 */
export function OptionTile({
  selected,
  icon,
  title,
  description,
  className,
  type = 'button',
  ...rest
}: OptionTileProps) {
  const density = useDensity();
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'group/option flex w-full items-center gap-3 rounded-card border bg-surface px-4 py-2.5 text-start shadow-e1 select-none touch-manipulation',
        'transition-[border-color,background-color,box-shadow,scale] duration-120 ease-standard enabled:motion-safe:active:scale-[0.99]',
        'aria-pressed:border-brand aria-pressed:bg-brand-soft/40 aria-pressed:ring-4 aria-pressed:ring-brand/10',
        'not-aria-pressed:border-line enabled:not-aria-pressed:hover:border-line-control',
        'disabled:cursor-not-allowed disabled:opacity-50',
        CONTROL_HEIGHT[density],
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-small bg-surface-muted text-ink-muted transition-colors duration-120 ease-standard group-aria-pressed/option:bg-brand group-aria-pressed/option:text-on-brand">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-ink">{title}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
      <ChoiceMark group="option" />
    </button>
  );
}

/**
 * A small choice among several words (a reason, a manager, a suggested name): a chip that is a
 * pressed button, like the ToggleChip of هوية 4, as tall as the density's controls.
 */
export function OptionChip({
  selected,
  className,
  children,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { selected: boolean }) {
  const density = useDensity();
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'group/chip inline-flex items-center gap-2 rounded-small border ps-3 pe-4 font-semibold select-none touch-manipulation',
        'transition-[background-color,border-color,color] duration-120 ease-standard',
        'aria-pressed:border-brand/30 aria-pressed:bg-brand-soft aria-pressed:text-brand-ink',
        'not-aria-pressed:border-line-control/50 not-aria-pressed:bg-surface not-aria-pressed:text-ink enabled:not-aria-pressed:hover:bg-surface-muted',
        'disabled:cursor-not-allowed disabled:opacity-50',
        density === 'touch' ? 'text-base' : 'text-sm',
        CONTROL_HEIGHT[density],
        className,
      )}
      {...rest}
    >
      <ChoiceMark group="chip" />
      {children}
    </button>
  );
}

/** A named group of choices: the name above it, like a field's label, and the group named by it. */
export function ChoiceGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-semibold text-ink-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className={className}>
        {children}
      </div>
    </div>
  );
}

/**
 * «سُجّل…»: what was just saved, as a calm success card: the check, the title, the number and the
 * amount, and what comes next.
 */
export function DoneCard({
  label,
  title,
  children,
  actions,
  className,
}: {
  /** The region's name for screen readers. */
  label: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'flex flex-col items-center gap-5 rounded-card border border-line bg-surface px-6 py-10 text-center shadow-e1 motion-safe:animate-rise sm:px-10',
        className,
      )}
    >
      <span className="grid size-20 place-items-center rounded-full bg-success-soft text-success-ink ring-8 ring-success-soft/40">
        <CheckIcon size={48} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-2xl font-bold text-ink">{title}</h2>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
    </section>
  );
}

/** One line of a summary: the name at the start, the value at the end, a hairline between lines. */
export function SummaryRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-12 items-center justify-between gap-4 border-b border-line py-2 last:border-b-0',
        className,
      )}
    >
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-end font-semibold text-ink">{children}</dd>
    </div>
  );
}
