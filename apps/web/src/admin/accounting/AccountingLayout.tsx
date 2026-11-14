import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { BookIcon, cn, CONTROL_HEIGHT, PageHeader, useDensity } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { inAccountingMode } from '../reports/access';
import { ReportScreen } from '../reports/parts';

const TABS = [
  { to: '/accounting/accounts', label: 'دليل الحسابات' },
  { to: '/accounting/journal', label: 'القيود' },
  { to: '/accounting/trial-balance', label: 'ميزان المراجعة' },
  { to: '/accounting/profit-loss', label: 'قائمة الدخل' },
] as const;

/**
 * The accounting section (12 › المحاسبة; admin/ChartJournal): shown only in accounting mode and to
 * accounting.view, where the accounting words (قيد، مدين، دائن) belong (14, 19). Its parts are tabs
 * that are addresses, so each can be opened and shared on its own. They are drawn as a segmented
 * track (هوية 4 › pill tabs), a step under the section's underline tabs in the header above them.
 */
export function AccountingLayout({
  title,
  description = 'وضع المحاسبة مفعّل · المبالغ بالعملة الأساسية',
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const me = useMe();
  const density = useDensity();
  return (
    <ReportScreen me={me} access={inAccountingMode} title={title}>
      <PageHeader title={title} description={description} icon={<BookIcon />} actions={actions} />
      <nav aria-label="أقسام المحاسبة" className="scrollbar-none -mt-1 max-w-full self-start overflow-x-auto">
        <ul
          className={cn(
            CONTROL_HEIGHT[density],
            'flex w-max items-stretch gap-1 rounded-control bg-surface-muted p-1',
          )}
        >
          {TABS.map((tab) => (
            <li key={tab.to} className="flex">
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center rounded-small px-3.5 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard focus-visible:-outline-offset-2',
                    isActive
                      ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                      : 'text-ink-muted hover:text-ink',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </ReportScreen>
  );
}
