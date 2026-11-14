import { cn, CheckIcon } from '@serva/ui';

export type LinkStep = 'method' | 'name' | 'waiting' | 'download';

const STEPS: { key: LinkStep; label: string }[] = [
  { key: 'method', label: 'ربط الجهاز' },
  { key: 'name', label: 'الاسم والفرع' },
  { key: 'waiting', label: 'موافقة المالك' },
  { key: 'download', label: 'التنزيل' },
];

/** The steps of setting up a cashier (kit: cashier/DeviceLink header). */
export function LinkSteps({ current, ownerSignedIn }: { current: LinkStep; ownerSignedIn: boolean }) {
  // The owner signing in on the device needs no approval from his phone.
  const steps = ownerSignedIn ? STEPS.filter((s) => s.key !== 'waiting') : STEPS;
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <ol aria-label="خطوات الإعداد" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const now = index === currentIndex;
        return (
          <li key={step.key} className="flex items-center gap-3" aria-current={now ? 'step' : undefined}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn('h-0.5 w-8 rounded-full', done || now ? 'bg-brand' : 'bg-line')}
              />
            ) : null}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'num grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition-colors duration-120 ease-standard',
                  done && 'border-brand bg-brand text-on-brand',
                  now && 'border-brand bg-brand-soft text-brand-ink ring-4 ring-brand/10',
                  !done && !now && 'border-line-control/50 bg-surface text-ink-muted',
                )}
              >
                {done ? <CheckIcon size={16} strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-sm',
                  now ? 'font-bold text-ink' : done ? 'font-semibold text-brand-ink' : 'text-ink-muted',
                )}
              >
                {step.label}
                {done ? <span className="sr-only"> (تمّت)</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
