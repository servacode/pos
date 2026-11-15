import { Link } from 'react-router';
import type { SectorKey } from '@serva/core';
import {
  BookIcon,
  CalendarIcon,
  Card,
  ClockIcon,
  CustomersIcon,
  IconChip,
  ListIcon,
  NextIcon,
  PageHeader,
  ReportsIcon,
  SalesIcon,
  ShieldCheckIcon,
  StockIcon,
  UserIcon,
  type Icon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { navFor } from '../../layout/nav';
import { storeSells } from '../../lib/sectors';
import { ReportScreen } from './parts';

interface Question {
  /** The question the owner asks */
  ask: string;
  /** One line of what the page shows */
  about: string;
  icon: Icon;
  /** Where the answer is; the path decides who sees it (the page's own key and business type) */
  to: string;
  /** The page (without its query) that must be open to this user */
  page: string;
  /** Only the shops of these business types ask it (seasons are a clothing idea) */
  sectors?: readonly SectorKey[];
  /** One of the questions asked most: shown first, in «الأكثر استخداماً», and not repeated below */
  top?: true;
}

const GROUPS: { title: string; questions: Question[] }[] = [
  {
    title: 'المبيعات',
    questions: [
      {
        ask: 'كم بعت اليوم؟',
        about: 'مبيعات اليوم وطرق الدفع.',
        icon: SalesIcon,
        to: '/sales/today',
        page: '/sales/today',
        top: true,
      },
      {
        ask: 'ماذا بعت في فترة، ومقارنةً بما قبلها؟',
        about: 'المبيع بالمنتج أو التصنيف، يوماً بيوم.',
        icon: ReportsIcon,
        to: '/reports/sales',
        page: '/reports/sales',
        top: true,
      },
      {
        ask: 'من باع أكثر، وكم عمولته؟',
        about: 'مبيع كل بائع وعمولته.',
        icon: UserIcon,
        to: '/reports/sales?by=seller',
        page: '/reports/sales',
      },
      {
        ask: 'كيف سار كل موسم؟',
        about: 'مبيع كل موسم ونسبة ما بيع مما استلمته.',
        icon: CalendarIcon,
        to: '/reports/sales?by=season',
        page: '/reports/sales',
        sectors: ['clothing'],
      },
      {
        ask: 'كم فاتورة صدرت، وما تفاصيلها؟',
        about: 'كل الفواتير، وابحث فيها برقم أو اسم.',
        icon: ListIcon,
        to: '/sales/invoices',
        page: '/sales/invoices',
      },
      {
        ask: 'ما وردياتي وكم فيها؟',
        about: 'كل وردية وما في صندوقها.',
        icon: ClockIcon,
        to: '/shifts',
        page: '/shifts',
      },
    ],
  },
  {
    title: 'البضاعة',
    questions: [
      {
        ask: 'ما الذي يتحرك وما الراكد؟',
        about: 'الأكثر مبيعاً، والقطع التي نامت على الرف.',
        icon: StockIcon,
        to: '/reports/merchandise',
        page: '/reports/merchandise',
        top: true,
      },
      {
        ask: 'كم تكلّف الوجبة؟',
        about: 'كلفة كل وجبة من موادها.',
        icon: StockIcon,
        to: '/reports/food-cost',
        page: '/reports/food-cost',
      },
      {
        ask: 'ماذا أُلغي بعد المطبخ؟',
        about: 'الأصناف الملغاة بعد وصولها المطبخ.',
        icon: ListIcon,
        to: '/reports/cancellations',
        page: '/reports/cancellations',
      },
    ],
  },
  {
    title: 'الزبائن والديون',
    questions: [
      {
        ask: 'من يدين لي ومنذ متى؟',
        about: 'الديون مقسّمة بحسب عمرها.',
        icon: CustomersIcon,
        to: '/reports/debt-ageing',
        page: '/reports/debt-ageing',
      },
    ],
  },
  {
    title: 'المحاسبة والرقابة',
    questions: [
      {
        ask: 'الدفاتر والميزان وقائمة الأرباح',
        about: 'القيود والميزان وقائمة الدخل.',
        icon: BookIcon,
        to: '/accounting',
        page: '/accounting',
      },
      {
        ask: 'ما الذي سجّلته الأجهزة؟',
        about: 'ما أرسلته الأجهزة وما وصل منه.',
        icon: ShieldCheckIcon,
        to: '/evidence',
        page: '/evidence',
      },
    ],
  },
];

/** «التقارير»: the reports gathered by the question they answer, accounting kept apart from sales. */
export function ReportsHomePage() {
  const me = useMe();
  const open = new Set(navFor(me).map((p) => p.to));
  const shown = GROUPS.map((g) => ({
    ...g,
    questions: g.questions.filter(
      (q) => open.has(q.page) && (!q.sectors || storeSells(me.tenant.sectors, q.sectors)),
    ),
  }));
  const top = shown.flatMap((g) => g.questions.filter((q) => q.top));
  const groups = [
    ...(top.length > 0 ? [{ title: 'الأكثر استخداماً', questions: top }] : []),
    ...shown.map((g) => ({ ...g, questions: g.questions.filter((q) => !q.top) })),
  ].filter((g) => g.questions.length > 0);
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
                    <IconChip tone="brand">
                      <q.icon size={20} />
                    </IconChip>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold text-ink">{q.ask}</span>
                      <span className="text-sm text-ink-muted">{q.about}</span>
                    </span>
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
