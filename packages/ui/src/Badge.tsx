import { Children, isValidElement, type ReactNode } from 'react';
import { cn } from './cn';
import * as icons from './icons';
import { ConnectedIcon, OfflineIcon } from './icons';

/**
 * The components of ./icons, to tell a badge that starts with its own icon by identity (never by
 * name, which minifying changes). It keeps every icon in the bundle; apps/web draws nearly all.
 */
const ICONS: ReadonlySet<unknown> = new Set(Object.values(icons));

/** True when the first thing in the badge is an icon of ./icons (or a bare <svg>). */
function startsWithIcon(children: ReactNode): boolean {
  const first = Children.toArray(children)[0];
  return isValidElement(first) && (first.type === 'svg' || ICONS.has(first.type));
}

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

// هوية 4 › Badge: a tinted pill with the tone's -ink words. Neutral is surface-muted/ink-muted.
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
};

const PILL =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap';

/** The 6 px dot in the words' own colour: the tone shows twice, never by colour alone. */
function Dot() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />;
}

/** A small label: a sector, a count, «جديد». For the status of a record use StatusChip. */
export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  /**
   * The dot before the words (هوية 4 › Badge). On by default, also before a number or an amount
   * (<bdi>, <Money>); a badge that starts with its own icon (e.g. a check before «متوازن») leaves
   * it out, as the icon already marks it.
   */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const showDot = dot ?? !startsWithIcon(children);
  return (
    <span className={cn(PILL, TONES[tone], className)}>
      {showDot ? <Dot /> : null}
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
    <span className={cn(PILL, TONES[tone], className)}>
      <Dot />
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
