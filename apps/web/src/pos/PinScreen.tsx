import { useCallback, useEffect, useState } from 'react';
import { cn, Keypad, LockIcon } from '@serva/ui';

const PIN_LENGTH = 4;
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function digitOf(key: string): string | null {
  if (/^[0-9]$/.test(key)) return key;
  const index = ARABIC_INDIC_DIGITS.indexOf(key);
  return index >= 0 ? String(index) : null;
}

function progress(count: number): string {
  if (count === 0) return 'لم يُكتب أي رقم بعد';
  if (count === 1) return 'كُتب رقم واحد من أربعة';
  if (count === 2) return 'كُتب رقمان من أربعة';
  return `كُتبت ${count} أرقام من أربعة`;
}

interface PinScreenProps {
  /** Called when the fourth digit is typed. */
  onComplete?: (pin: string) => void;
}

/**
 * The cashier's login-code pad (kit: cashier/Login). It works from the screen keypad or a physical
 * keyboard (Latin or Arabic-Indic digits, Backspace). Checking the code against the staff records
 * kept on the device comes with device linking.
 */
export function PinScreen({ onComplete }: PinScreenProps) {
  const [pin, setPin] = useState('');

  const press = useCallback(
    (digit: string) => {
      if (pin.length >= PIN_LENGTH) return;
      const next = pin + digit;
      setPin(next);
      if (next.length === PIN_LENGTH) onComplete?.(next);
    },
    [pin, onComplete],
  );

  const erase = useCallback(() => setPin((current) => current.slice(0, -1)), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const digit = digitOf(event.key);
      if (digit) press(digit);
      else if (event.key === 'Backspace') erase();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [press, erase]);

  return (
    <section
      aria-labelledby="pin-title"
      className="flex w-full max-w-md flex-col items-center gap-6 rounded-card border border-line bg-surface p-8 shadow-e2"
    >
      <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand-ink">
        <LockIcon size={32} />
      </span>
      <div className="flex flex-col items-center text-center">
        <h1 id="pin-title" className="text-xl font-semibold text-ink">
          اكتب رمز الدخول
        </h1>
        <p className="text-sm text-ink-muted">رمز من 4 أرقام</p>
      </div>

      <div role="status" dir="ltr" className="flex justify-center gap-6 py-2">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              'size-5 rounded-full',
              index < pin.length ? 'bg-ink' : 'border-2 border-line-control',
            )}
          />
        ))}
        <span className="sr-only">{progress(pin.length)}</span>
      </div>

      <Keypad onDigit={press} onBackspace={erase} />

      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <LockIcon size={16} />
        يفتح من هذا الجهاز نفسه، حتى دون إنترنت.
      </p>
    </section>
  );
}
