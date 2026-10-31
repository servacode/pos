import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn, Keypad, LockIcon } from '@serva/ui';
import { useNow } from '../lib/useNow';
import { FREE_ATTEMPTS } from './staff/verifier';

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function digitOf(key: string): string | null {
  if (/^[0-9]$/.test(key)) return key;
  const index = ARABIC_INDIC_DIGITS.indexOf(key);
  return index >= 0 ? String(index) : null;
}

function progress(count: number, length: 4 | 6): string {
  const of = length === 4 ? 'أربعة' : 'ستة';
  if (count === 0) return 'لم يُكتب أي رقم بعد';
  if (count === 1) return `كُتب رقم واحد من ${of}`;
  if (count === 2) return `كُتب رقمان من ${of}`;
  return `كُتبت ${count} أرقام من ${of}`;
}

/** «0:47» for a lock countdown. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export type PinStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'wrong'; failures: number }
  | { kind: 'locked'; until: number }
  /** A refusal that is not about the digits («لم يدخل من قبل على هذا الجهاز») */
  | { kind: 'message'; text: string };

export interface PinPadProps {
  length?: 4 | 6;
  /** Called when the last digit is typed; the dots clear once it settles. */
  onComplete?: (pin: string) => void | Promise<void>;
  status?: PinStatus;
  /** Digits from the physical keyboard too (off while another field owns the keyboard). */
  captureKeyboard?: boolean;
  /** The group's name for screen readers */
  label?: string;
  className?: string;
}

/**
 * The code pad (kit cashier/Login): hidden dots, the 64 px keypad (7 8 9 on top, never mirrored),
 * Latin or Arabic-Indic digits from a keyboard, a shake on a wrong code and a countdown while
 * locked (16: after 5 wrong codes, a minute that doubles).
 */
export function PinPad({
  length = 4,
  onComplete,
  status = { kind: 'idle' },
  captureKeyboard = true,
  label = 'لوحة الأرقام',
  className,
}: PinPadProps) {
  const [pin, setPin] = useState('');
  const busy = useRef(false);
  const locked = status.kind === 'locked';
  const now = useNow(1000, locked);
  const lockedNow = locked && status.until > now;
  const disabled = lockedNow || status.kind === 'checking';

  const typed = useRef('');
  const show = useCallback((value: string) => {
    typed.current = value;
    setPin(value);
  }, []);

  const press = useCallback(
    (digit: string) => {
      if (busy.current || disabled || typed.current.length >= length) return;
      const next = typed.current + digit;
      show(next);
      if (next.length < length) return;
      busy.current = true;
      void Promise.resolve(onComplete?.(next)).finally(() => {
        busy.current = false;
        show('');
      });
    },
    [length, onComplete, disabled, show],
  );

  const erase = useCallback(() => show(typed.current.slice(0, -1)), [show]);

  useEffect(() => {
    if (!captureKeyboard) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const digit = digitOf(event.key);
      if (digit) press(digit);
      else if (event.key === 'Backspace') erase();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [press, erase, captureKeyboard]);

  const wrong = status.kind === 'wrong';
  return (
    <div className={cn('flex w-full flex-col items-center gap-4', className)}>
      <div
        role={wrong || lockedNow ? 'alert' : 'status'}
        dir="ltr"
        className={cn('flex justify-center gap-5 py-1.5', wrong && 'pin-shake')}
      >
        {Array.from({ length }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              'size-5 rounded-full',
              wrong || lockedNow
                ? 'border-2 border-danger'
                : index < pin.length
                  ? 'bg-ink'
                  : 'border-2 border-line-control',
            )}
          />
        ))}
        <span className="sr-only">
          {lockedNow ? 'الدخول متوقف مؤقتاً' : wrong ? 'رمز غير صحيح' : progress(pin.length, length)}
        </span>
      </div>

      {lockedNow ? (
        <div className="flex w-full items-center gap-3 rounded-control bg-danger-soft p-3 text-danger-ink">
          <span className="num text-2xl font-bold" dir="ltr">
            {countdown(status.until - now)}
          </span>
          <span className="flex flex-col text-sm">
            <span className="font-semibold">رمز غير صحيح. توقف الدخول مؤقتاً.</span>
            <span>محاولات خاطئة كثيرة. حاول بعد انتهاء العدّ، وتتضاعف المدة إن تكرر الخطأ.</span>
          </span>
        </div>
      ) : wrong ? (
        <p className="text-sm font-semibold text-danger-ink">
          رمز غير صحيح.{' '}
          {status.failures < FREE_ATTEMPTS
            ? `بقيت ${FREE_ATTEMPTS - status.failures} من ${FREE_ATTEMPTS} محاولات قبل توقف الدخول.`
            : ''}
        </p>
      ) : status.kind === 'message' ? (
        <p role="alert" className="text-center text-sm font-semibold text-warning-ink">
          {status.text}
        </p>
      ) : null}

      <Keypad label={label} onDigit={press} onBackspace={erase} disabled={disabled} />
    </div>
  );
}

interface PinScreenProps {
  heading: ReactNode;
  subheading?: ReactNode;
  avatar?: ReactNode;
  length?: 4 | 6;
  onComplete?: (pin: string) => void | Promise<void>;
  status?: PinStatus;
  footer?: ReactNode;
}

/** The sign-in card around the pad (kit cashier/Login, frame 1). */
export function PinScreen({
  heading,
  subheading,
  avatar,
  length = 4,
  onComplete,
  status,
  footer,
}: PinScreenProps) {
  return (
    <section
      aria-labelledby="pin-title"
      className="flex w-full max-w-110 flex-col items-center gap-4 rounded-[1.75rem] border border-line bg-surface px-8 py-7 shadow-e2"
    >
      {avatar ?? (
        <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand-ink">
          <LockIcon size={32} />
        </span>
      )}
      <div className="flex flex-col items-center text-center">
        <h2 id="pin-title" className="text-2xl font-bold text-ink">
          {heading}
        </h2>
        {subheading ? <p className="text-sm text-ink-muted">{subheading}</p> : null}
      </div>
      <PinPad length={length} onComplete={onComplete} status={status} />
      {footer ?? (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <LockIcon size={16} />
          يفتح من هذا الجهاز نفسه، حتى دون إنترنت.
        </p>
      )}
    </section>
  );
}
