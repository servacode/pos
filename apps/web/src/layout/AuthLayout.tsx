import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  AreaChart,
  BarcodeIcon,
  Card,
  CashIcon,
  CheckCircleIcon,
  IconChip,
  Logo,
  LOGO_S_PATH,
  Money,
  ReportsIcon,
  SalesIcon,
  ThemeToggle,
  TrendUpIcon,
} from '@serva/ui';

const BENEFITS = [
  { icon: BarcodeIcon, text: 'بيع سريع وإيصال واضح بضغطة زر' },
  { icon: CashIcon, text: 'الليرة السورية والدولار جاهزان من أول يوم' },
  { icon: ReportsIcon, text: 'مخزونك وأرباحك بلغة بسيطة، دون محاسبة معقدة' },
] as const;

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  footer: ReactNode;
  /** Above the title: where the visitor stands in a flow of steps (opening a store). */
  steps?: ReactNode;
  children: ReactNode;
}

/**
 * Signing in and opening a store (هوية 4): the form on a calm surface with the logo and the theme
 * switch above it, and on a wide screen the brand side in the deep-emerald sidebar colours, with a
 * preview of a store's day and three promises. On a phone or a tablet, the form alone.
 */
export function AuthLayout({ title, subtitle, footer, steps, children }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <main className="flex min-h-dvh flex-col px-5 pt-3 pb-10 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="flex min-h-12 items-center rounded-control" aria-label="سيرفا">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col pt-10 sm:justify-center sm:pb-6 motion-safe:animate-rise">
          {steps}
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 text-ink-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-8 text-center text-sm text-ink-muted">{footer}</p>
        </div>
      </main>
      <BrandSide />
    </div>
  );
}

/**
 * The wide screen's brand side: the promise, what it gives a shop, and a glimpse of the product. On a
 * short laptop screen (a 768 screen leaves about 650 inside the browser) the spacing tightens, then
 * the preview's figures and at last its chart step aside, so nothing is ever cut.
 */
function BrandSide() {
  return (
    <aside className="sticky top-0 hidden h-dvh p-3 ps-0 lg:block">
      <div className="relative isolate flex h-full flex-col overflow-hidden rounded-panel border border-sidebar-line bg-sidebar px-10 py-12 xl:px-16 [@media(max-height:50rem)]:py-8">
        {/* The «S» of the mark, drawn large and faint behind everything: the brand without a word. */}
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute -end-32 -top-36 -z-10 size-[30rem] text-sidebar-hover/70"
        >
          <path d={LOGO_S_PATH} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </svg>
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center-safe gap-12 [@media(max-height:50rem)]:gap-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-sidebar-brand">سيرفا · منصة إدارة التجزئة</p>
              <p className="text-3xl font-bold text-sidebar-strong">كاشير سحابي بسيط، مصمّم لمحلّك</p>
            </div>
            <ul className="flex flex-col gap-3">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-[0.9375rem] text-sidebar-ink">
                  <span className="grid size-8 shrink-0 place-items-center rounded-small bg-sidebar-active text-sidebar-brand">
                    <Icon />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <StorePreview />
        </div>
      </div>
    </aside>
  );
}

// A week of a boutique's net sales in the new pound, oldest first (time runs from the right).
const WEEK = ['الجمعة', 'السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const WEEK_AXIS = ['جمعة', 'سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'اليوم'];
const WEEK_SALES = [6400, 9200, 7800, 11900, 9600, 12100, 13420];

/**
 * A glimpse of the owner's home page, drawn with the real components in the current theme: today's
 * sales with its trend, the week's chart and three figures, and the toast of a sale just saved.
 * A picture only: hidden from screen readers and out of the tab order.
 */
function StorePreview() {
  return (
    <div aria-hidden="true" inert className="relative pb-6">
      <Card className="flex flex-col gap-4 shadow-e3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconChip>
              <SalesIcon />
            </IconChip>
            <div className="flex flex-col">
              <p className="text-sm text-ink-muted">مبيعات اليوم</p>
              <p className="text-kpi font-bold tracking-tight text-ink">
                <Money minor={1342000} currency="SYP" unitClassName="text-sm font-semibold text-ink-subtle" />
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-ink">
              <TrendUpIcon size={16} />
              <bdi className="num">11%</bdi>
            </span>
            <span className="text-xs text-ink-subtle">عن أمس</span>
          </div>
        </div>
        <AreaChart
          className="[@media(max-height:39rem)]:hidden"
          label="المبيعات آخر 7 أيام"
          labels={WEEK}
          axisLabels={WEEK_AXIS}
          series={[{ key: 'sales', label: 'المبيعات', values: WEEK_SALES }]}
          height={112}
        />
        <dl className="grid grid-cols-3 divide-x divide-line border-t border-line pt-4 [@media(max-height:44rem)]:hidden">
          <PreviewFigure label="الفواتير">
            <span className="num">42</span>
          </PreviewFigure>
          <PreviewFigure label="متوسط الفاتورة">
            <Money minor={32000} currency="SYP" unitClassName="text-xs text-ink-subtle" />
          </PreviewFigure>
          <PreviewFigure label="هامش الربح">
            <span className="num">41.2%</span>
          </PreviewFigure>
        </dl>
      </Card>
      <p className="absolute start-8 bottom-0 flex items-center gap-2.5 rounded-card bg-ink py-2.5 ps-3 pe-4 text-sm font-semibold text-surface shadow-e3">
        <CheckCircleIcon
          size={24}
          strokeWidth={2.25}
          className="fill-success text-surface [&_circle]:stroke-none"
        />
        حُفظت الفاتورة <bdi className="num">INV-0000430</bdi> وطُبع الإيصال
      </p>
    </div>
  );
}

function PreviewFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 first:ps-0 last:pe-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-base font-bold text-ink">{children}</dd>
    </div>
  );
}
