import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';
import { BackspaceIcon } from '../icons';

// Calculator order, never mirrored (tab 14 › لوحات الأرقام لا تنقلب): 7 8 9 on top, from the left.
const KEY_ROWS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const;

/*
 * هوية 4 › لوحة الأرقام: each key is a secondary button 64 high (the cashier's widest target), its
 * digit 24 in equal-width figures. Pressed, it sinks to the muted fill and shrinks a touch; the
 * backspace key keeps the quieter ink of an action, not a digit.
 */
const KEY =
  'num grid h-16 place-items-center rounded-control border border-line-control/50 bg-surface text-2xl font-semibold text-ink shadow-e1 transition-[background-color,box-shadow,scale] duration-80 ease-standard select-none touch-manipulation hover:bg-surface-muted active:bg-surface-muted active:shadow-none motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50';

/** The same key, 48 high and a size smaller: a phone's pay screen, where the methods and the notes must stay in view */
const KEY_COMPACT = KEY.replace('h-16', 'h-12').replace('text-2xl', 'text-xl');

function Key({ className, compact, ...props }: ComponentProps<'button'> & { compact?: boolean }) {
  return <button type="button" className={cn(compact ? KEY_COMPACT : KEY, className)} {...props} />;
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
  /** Keys of 48 instead of 64, for a phone's pay screen */
  compact?: boolean;
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
  compact = false,
  className,
}: KeypadProps) {
  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div role="group" aria-label={label} dir="ltr" className="grid w-full grid-cols-3 gap-2">
        {KEY_ROWS.map((digit) => (
          <Key key={digit} compact={compact} disabled={disabled} onClick={() => onDigit(digit)}>
            {digit}
          </Key>
        ))}
        {extraKey ? (
          <Key compact={compact} disabled={disabled} onClick={onExtraKey}>
            {extraKey}
          </Key>
        ) : (
          <span aria-hidden="true" />
        )}
        <Key compact={compact} disabled={disabled} onClick={() => onDigit('0')}>
          0
        </Key>
        <Key compact={compact} disabled={disabled} onClick={onBackspace} aria-label={backspaceLabel}>
          <BackspaceIcon size={24} className="text-ink-muted" />
        </Key>
      </div>
      {quickAmounts ? <div className="grid grid-cols-2 gap-2">{quickAmounts}</div> : null}
    </div>
  );
}
