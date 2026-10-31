import type { ReactNode } from 'react';
import { cn } from './cn';
import { ConnectedIcon, OfflineIcon } from './icons';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted ring-line',
  brand: 'bg-brand-soft text-brand-ink ring-brand/20',
  success: 'bg-success-soft text-success-ink ring-success/20',
  warning: 'bg-warning-soft text-warning-ink ring-warning/20',
  danger: 'bg-danger-soft text-danger-ink ring-danger/20',
  info: 'bg-info-soft text-info-ink ring-info/20',
};

/** A small label: a sector, a count, «جديد». For the status of a record use StatusChip. */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The statuses of tab 14 › الشارة, each with its fixed colour and word. Colour never works alone:
 * the word is always there. «آجلة» and a customer's debt are money owed to the shop, not an error,
 * so they are neutral; red is only for debt past its due date.
 */
export const STATUSES = {
  paid: { tone: 'success', label: 'مدفوعة' },
  credit: { tone: 'neutral', label: 'آجلة' },
  awaitingPayment: { tone: 'warning', label: 'بانتظار الدفع' },
  debt: { tone: 'neutral', label: 'دين' },
  overdueDebt: { tone: 'danger', label: 'دين متأخر' },
  cancelled: { tone: 'danger', label: 'ملغاة' },
  pendingSend: { tone: 'warning', label: 'بانتظار الإرسال' },
  sent: { tone: 'success', label: 'أُرسلت' },
  draft: { tone: 'neutral', label: 'مسودة' },
  active: { tone: 'success', label: 'نشط' },
  suspended: { tone: 'danger', label: 'موقوف' },
  pendingApproval: { tone: 'warning', label: 'بانتظار موافقتك' },
  rejected: { tone: 'neutral', label: 'مرفوض' },
  lowStock: { tone: 'warning', label: 'قارب على النفاد' },
} as const satisfies Record<string, { tone: BadgeTone; label: string }>;

export type Status = keyof typeof STATUSES;

const CHIP_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
};

/** The status of a record (kit .badge): a dot, the colour and the word. `children` adds a count. */
export function StatusChip({
  status,
  className,
  children,
}: {
  status: Status;
  className?: string;
  children?: ReactNode;
}) {
  const { tone, label } = STATUSES[status];
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold whitespace-nowrap',
        CHIP_TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
      {children}
      {label}
    </span>
  );
}

/**
 * The connection pill of the cashier, rep and waiter (kit .conn): «متصل», or what goes on without
 * internet. The caller passes the full offline text from the strings file.
 */
export function ConnectionPill({ online, children }: { online: boolean; children?: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
        online ? 'bg-success-soft text-success-ink' : 'bg-warning-soft text-warning-ink',
      )}
    >
      {online ? <ConnectedIcon size={16} /> : <OfflineIcon size={16} />}
      {children ?? (online ? 'متصل' : 'دون إنترنت · البيع مستمر')}
    </span>
  );
}
