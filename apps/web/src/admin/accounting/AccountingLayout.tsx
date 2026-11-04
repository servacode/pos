import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AccountingIcon, cn, PageHeader } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { inAccountingMode } from '../reports/access';
import { ReportScreen } from '../reports/parts';

const TABS = [
  { to: '/accounting/accounts', label: 'دليل الحسابات' },
  { to: '/accounting/journal', label: 'القيود' },
  { to: '/accounting/trial-balance', label: 'ميزان المراجعة' },
] as const;

/**
 * The accounting section (12 › المحاسبة; admin/ChartJournal): shown only in accounting mode and to
 * accounting.view, where the accounting words (قيد، مدين، دائن) belong (14, 19). Its parts are tabs
 * that are addresses, so each can be opened and shared on its own.
 */
export function AccountingLayout({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const me = useMe();
  return (
    <ReportScreen me={me} access={inAccountingMode} title={title}>
      <PageHeader
        className="mb-0 print:hidden"
        icon={AccountingIcon}
        eyebrow="المال / المحاسبة"
        title={title}
        description="وضع المحاسبة مفعّل · المبالغ بالعملة الأساسية"
        actions={actions}
      />
      <nav
        aria-label="أقسام المحاسبة"
        className="scrollbar-none flex gap-1 overflow-x-auto border-b border-line print:hidden"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'relative inline-flex min-h-12 shrink-0 items-center px-4 font-semibold whitespace-nowrap transition-colors duration-120',
                isActive
                  ? 'text-brand-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand'
                  : 'text-ink-muted hover:text-ink',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </ReportScreen>
  );
}
