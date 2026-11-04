import type { ReactNode } from 'react';
import { Button, cn } from '@serva/ui';

/** An icon at the start of a field; it turns brand while the field has focus. */
export function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="ps-4 text-ink-subtle transition-colors duration-120 group-focus-within:text-brand"
    >
      {children}
    </span>
  );
}

/** The sign-in pages' fields: filled, with the icon tile; spread on a TextField or PasswordField. */
export const authField = { appearance: 'filled', className: 'group' } as const;

/** The 6-digit code: large, spaced digits. */
export const codeInputClass = 'text-center! text-2xl! font-semibold tracking-[0.4em] tabular-nums';

/** «الخطوة 1 من 2» with a two-part bar, above the title of a two-step form. */
export function StepBadge({ step, of, label }: { step: number; of: number; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-brand-ink">
        الخطوة {step} من {of} · {label}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < step ? 'bg-brand' : 'bg-line')} />
        ))}
      </div>
    </div>
  );
}

/**
 * The local server's test mode: there is no SMS there, so the code is shown here, clearly marked
 * as a test, with a button that types it in.
 */
export function TestCodeBox({ code, onFill }: { code: string; onFill: () => void }) {
  // "123 456", isolated (LRI…PDI) so the digits keep their order inside the Arabic sentence.
  const spaced = `⁦${code.slice(0, 3)} ${code.slice(3)}⁩`;
  return (
    <div
      role="note"
      aria-label="وضع التجربة"
      className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-warning/40 bg-warning-soft px-4 py-3 text-warning-ink"
    >
      <p className="font-semibold">
        وضع التجربة — الرمز: <span className="text-lg tabular-nums">{spaced}</span>
      </p>
      <Button type="button" variant="secondary" size="md" onClick={onFill}>
        املأ الرمز
      </Button>
    </div>
  );
}
