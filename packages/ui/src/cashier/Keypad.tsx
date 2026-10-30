import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import { BackspaceIcon } from '../icons';

// Calculator order, never mirrored (tab 14 › لوحات الأرقام لا تنقلب): 7 8 9 on top, from the left.
const KEY_ROWS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const;

const KEY =
  'grid h-16 place-items-center rounded-control border border-line bg-surface text-2xl font-semibold text-ink tabular-nums transition-colors duration-80 select-none hover:bg-surface-muted active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50';

function Key({ className, ...props }: ComponentProps<'button'>) {
  return <button type="button" className={cn(KEY, className)} {...props} />;
}

export interface KeypadProps {
  /** The group's name for screen readers («لوحة الأرقام»). */
  label?: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  /** The key left of 0: the decimal point for amounts and weights, «00» for quick entry, or none. */
  extraKey?: '.' | '00' | null;
  onExtraKey?: () => void;
  backspaceLabel?: string;
  /** Quick cash notes under the keys (tab 14 › لوحة الأرقام), e.g. <Button>s for 5,000 and 10,000. */
  quickAmounts?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * The touch keypad of the cashier and of the login code (kit .keypad): keys of 64, always LTR with
 * 7 8 9 on top, backspace at the bottom right.
 */
export function Keypad({
  label = 'لوحة الأرقام',
  onDigit,
  onBackspace,
  extraKey = null,
  onExtraKey,
  backspaceLabel = 'امسح رقماً',
  quickAmounts,
  disabled = false,
  className,
}: KeypadProps) {
  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div role="group" aria-label={label} dir="ltr" className="grid w-full grid-cols-3 gap-2">
        {KEY_ROWS.map((digit) => (
          <Key key={digit} disabled={disabled} onClick={() => onDigit(digit)}>
            {digit}
          </Key>
        ))}
        {extraKey ? (
          <Key disabled={disabled} onClick={onExtraKey}>
            {extraKey}
          </Key>
        ) : (
          <span aria-hidden="true" />
        )}
        <Key disabled={disabled} onClick={() => onDigit('0')}>
          0
        </Key>
        <Key disabled={disabled} onClick={onBackspace} aria-label={backspaceLabel}>
          <BackspaceIcon size={24} />
        </Key>
      </div>
      {quickAmounts ? <div className="grid grid-cols-2 gap-2">{quickAmounts}</div> : null}
    </div>
  );
}
