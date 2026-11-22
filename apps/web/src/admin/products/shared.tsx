import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { cn, EmptyState as UiEmptyState, type EmptyStateProps } from '@serva/ui';

/**
 * The pieces every products page shares, so a dashed box looks and behaves the same on the prices
 * preview, the price list, the tax rates, the import and the bulk photos.
 */

/** A list with nothing in it yet: the same dashed frame everywhere, a little tighter than the library's. */
export function EmptyState({ className, ...props }: EmptyStateProps) {
  return <UiEmptyState {...props} className={cn('py-8', className)} />;
}

/**
 * Where a file goes: a dashed box the owner can click or drop a file on. The real input inside is
 * what screen readers and keyboards use. `onFiles` gets what was picked or dropped.
 */
export function DropZone({
  title,
  hint,
  accept,
  ariaLabel,
  multiple = false,
  disabled = false,
  busyText,
  onFiles,
  className,
  children,
}: {
  title: string;
  hint?: ReactNode;
  accept: string;
  ariaLabel: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Shown instead of the hint while the file is being read */
  busyText?: string | null;
  onFiles: (files: File[]) => void;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const [over, setOver] = useState(false);

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = [...event.dataTransfer.files];
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed px-6 py-8 text-center transition-[background-color,border-color] duration-120 ease-standard',
        over
          ? 'border-brand bg-brand-soft/40'
          : 'border-line-control/50 hover:border-brand/50 hover:bg-brand-soft/30',
        disabled ? 'cursor-wait opacity-70' : 'cursor-pointer',
        className,
      )}
    >
      <span className="font-semibold text-ink">{title}</span>
      {busyText ? (
        <span className="text-sm text-ink-muted">{busyText}</span>
      ) : hint ? (
        <span className="text-sm text-ink-muted">{hint}</span>
      ) : null}
      {children}
      <input
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

/** «▲ 250» for a rise and «▼ 250» for a fall: the same pill, a warm tone up and a green one down */
export function DeltaPill({ rise, children }: { rise: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        rise
          ? 'border-warning/30 bg-warning-soft text-warning-ink'
          : 'border-success/30 bg-success-soft text-success-ink',
      )}
    >
      <span className="sr-only">{rise ? 'ارتفع' : 'انخفض'}</span>
      <span aria-hidden="true">{rise ? '▲' : '▼'}</span>
      {children}
    </span>
  );
}
