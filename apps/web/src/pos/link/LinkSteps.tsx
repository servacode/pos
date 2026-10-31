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
    <ol aria-label="خطوات الإعداد" className="flex flex-wrap items-center gap-2.5">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const now = index === currentIndex;
        return (
          <li key={step.key} className="flex items-center gap-2.5" aria-current={now ? 'step' : undefined}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn('h-0.5 w-7 rounded-full', done || now ? 'bg-brand' : 'bg-line')}
              />
            ) : null}
            <span
              className={cn(
                'num grid size-7 place-items-center rounded-full text-sm font-bold',
                done && 'bg-brand text-on-brand',
                now && 'border-2 border-brand bg-brand-soft text-brand-ink',
                !done && !now && 'border-[1.5px] border-line-control text-ink-muted',
              )}
            >
              {done ? <CheckIcon size={16} /> : index + 1}
            </span>
            <span
              className={cn(
                'text-sm font-semibold',
                now ? 'font-bold text-ink' : done ? 'text-brand-ink' : 'text-ink-muted',
              )}
            >
              {step.label}
              {done ? <span className="sr-only"> (تمّت)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
