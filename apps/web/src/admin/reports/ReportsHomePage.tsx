import { Link } from 'react-router';
import { Card, NextIcon, PageHeader, ReportsIcon } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { navFor } from '../../layout/nav';
import { ReportScreen } from './parts';

interface Question {
  /** The question the owner asks */
  ask: string;
  /** Where the answer is; the path decides who sees it (the page's own key and business type) */
  to: string;
  /** The page (without its query) that must be open to this user */
  page: string;
}

const GROUPS: { title: string; questions: Question[] }[] = [
  {
    title: 'المبيعات',
    questions: [
      { ask: 'كم بعت اليوم؟', to: '/sales/today', page: '/sales/today' },
      { ask: 'ماذا بعت في فترة، ومقارنةً بما قبلها؟', to: '/reports/sales', page: '/reports/sales' },
      { ask: 'من باع أكثر، وكم عمولته؟', to: '/reports/sales?by=seller', page: '/reports/sales' },
      { ask: 'كيف سار كل موسم؟', to: '/reports/sales?by=season', page: '/reports/sales' },
      { ask: 'كم فاتورة صدرت، وما تفاصيلها؟', to: '/sales/invoices', page: '/sales/invoices' },
      { ask: 'ما وردياتي وكم فيها؟', to: '/shifts', page: '/shifts' },
    ],
  },
  {
    title: 'البضاعة',
    questions: [
      { ask: 'ما الذي يتحرك وما الراكد؟', to: '/reports/merchandise', page: '/reports/merchandise' },
      { ask: 'كم تكلّف الوجبة؟', to: '/reports/food-cost', page: '/reports/food-cost' },
      { ask: 'ماذا أُلغي بعد المطبخ؟', to: '/reports/cancellations', page: '/reports/cancellations' },
    ],
  },
  {
    title: 'الزبائن والديون',
    questions: [{ ask: 'من يدين لي ومنذ متى؟', to: '/reports/debt-ageing', page: '/reports/debt-ageing' }],
  },
  {
    title: 'المحاسبة والرقابة',
    questions: [
      { ask: 'الدفاتر والميزان وقائمة الأرباح', to: '/accounting', page: '/accounting' },
      { ask: 'ما الذي سجّلته الأجهزة؟', to: '/evidence', page: '/evidence' },
    ],
  },
];

/** «التقارير»: the reports gathered by the question they answer, accounting kept apart from sales. */
export function ReportsHomePage() {
  const me = useMe();
  const open = new Set(navFor(me).map((p) => p.to));
  const groups = GROUPS.map((g) => ({
    ...g,
    questions: g.questions.filter((q) => open.has(q.page)),
  })).filter((g) => g.questions.length > 0);
  return (
    <ReportScreen
      me={me}
      access={['report.view', 'reports.financial', 'accounting.view', 'devices.view']}
      title="التقارير"
    >
      <PageHeader title="التقارير" description="اختر السؤال الذي تريد جوابه." icon={<ReportsIcon />} />
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">{group.title}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.questions.map((q) => (
              <li key={q.to}>
                <Link to={q.to} className="block">
                  <Card className="flex items-center gap-3 transition-colors duration-120 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1 font-semibold text-ink">{q.ask}</span>
                    <NextIcon size={16} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ReportScreen>
  );
}
