import { useId, type FormEvent, type ReactNode, type Ref } from 'react';
import {
  AlertCircleIcon,
  CashIcon,
  Card,
  CheckCircleIcon,
  cn,
  GiftIcon,
  IconChip,
  ListIcon,
  StoreIcon,
  WeighedIcon,
  type Icon,
} from '@serva/ui';

/** A part of «إعدادات المتجر»: where the page's side list leads, and the card's own title. */
export interface SettingsSection {
  /** The card's id, the address of its place on the page (#store-currency). */
  id: string;
  title: string;
  description: string;
  icon: Icon;
}

export const SETTINGS_SECTIONS = {
  profile: {
    id: 'store-profile',
    title: 'المحل والفاتورة',
    description: 'الاسم والعنوان والهاتف، وما يُطبع في رأس الفاتورة وأسفلها.',
    icon: StoreIcon,
  },
  currency: {
    id: 'store-currency',
    title: 'العملة وسعر الصرف',
    description: 'الدولار وسعره اليوم، وهل تشمل أسعار الرفوف الضريبة.',
    icon: CashIcon,
  },
  scale: {
    id: 'store-scale',
    title: 'باركود الميزان',
    description: 'كيف يطبع ميزانك ملصقات الأصناف الموزونة، ليقرأها الكاشير بمسحة واحدة.',
    icon: WeighedIcon,
  },
  service: {
    id: 'store-service',
    title: 'الصالة والمطبخ',
    description: 'نوع الطلب ورقمه، وطاولات الصالة، وورقة المطبخ.',
    icon: ListIcon,
  },
  loyalty: {
    id: 'store-loyalty',
    title: 'نقاط الولاء',
    description: 'يجمع الزبون نقاطاً على مشترياته، ويصرفها عند الدفع.',
    icon: GiftIcon,
  },
} as const satisfies Record<string, SettingsSection>;

/**
 * One form of the settings (هوية 4 › Card + CardHeader, forms in titled cards): the icon tile, the
 * title and a line of description, the fields, and the save bar at its foot. A long form's bar
 * (`stickyBar`) stays at the bottom of the window while the card is taller than the screen, so
 * «احفظ» is never a scroll away, and comes to rest at the card's foot. Without a section (the start
 * wizard, whose step names the form) the card has no header of its own.
 */
export function SettingsCard({
  section,
  label,
  formRef,
  onSubmit,
  footer,
  stickyBar = false,
  children,
  className,
}: {
  section?: SettingsSection;
  /** The form's name for screen readers when it has no section title. */
  label?: string;
  formRef?: Ref<HTMLFormElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** The save bar: a status at the start, the buttons at the end. */
  footer: ReactNode;
  /** A form taller than a screen keeps its save bar in view. */
  stickyBar?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const SectionIcon = section?.icon;
  return (
    <Card id={section?.id} className={cn('scroll-mt-32', className)}>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        aria-labelledby={section ? titleId : undefined}
        aria-label={section ? undefined : label}
        className="flex flex-col"
      >
        {section && SectionIcon ? (
          <div className="mb-6 flex items-start gap-3">
            <IconChip>
              <SectionIcon />
            </IconChip>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {section.title}
              </h2>
              <p className="text-sm text-ink-muted">{section.description}</p>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-5">{children}</div>
        <CardBar sticky={stickyBar}>{footer}</CardBar>
      </form>
    </Card>
  );
}

/** «حُفظ…» at the start of a save bar, with its check: it says itself when it appears. */
export function SavedNote({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="me-auto flex min-w-0 items-start gap-2 text-sm font-semibold text-success-ink"
    >
      <CheckCircleIcon size={16} className="mt-0.5" />
      {children}
    </p>
  );
}

/**
 * Why the save failed, at the start of the save bar where the eyes are after pressing «احفظ»: the
 * danger ink with its icon, read out at once.
 */
export function FailedNote({ children }: { children: string }) {
  return (
    <p role="alert" className="me-auto flex min-w-0 items-start gap-2 text-sm font-semibold text-danger-ink">
      <AlertCircleIcon size={16} className="mt-0.5" />
      {children}
    </p>
  );
}

/**
 * The foot of a card (هوية 4 › sticky action bar): out to the card's edges over a hairline, a
 * status at the start and the buttons at the end. Sticky, it stays at the bottom of the window
 * while its card is taller than the screen, the page blurring under it.
 */
export function CardBar({ sticky = false, children }: { sticky?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        '-mx-5 -mb-5 mt-6 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-b-card border-t border-line px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6',
        sticky && 'sticky bottom-0 z-10 bg-surface/90 backdrop-blur-md',
      )}
    >
      {children}
    </div>
  );
}
