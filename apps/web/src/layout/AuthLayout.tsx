import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  CashIcon,
  type Icon,
  Logo,
  LogoMark,
  LOGO_S_PATH,
  OfflineIcon,
  PrintIcon,
  ReportsIcon,
  ShieldCheckIcon,
  TrendUpIcon,
} from '@serva/ui';

const BENEFITS: { icon: Icon; title: string; text: string }[] = [
  { icon: CashIcon, title: 'الليرة والدولار', text: 'بعملتين من أول يوم، وسعر الصرف بيدك.' },
  { icon: OfflineIcon, title: 'يبيع دون إنترنت', text: 'انقطع الخط؟ الكاشير يكمل، ويرسل حين يعود.' },
  { icon: ReportsIcon, title: 'أرباحك بوضوح', text: 'مخزونك وربحك اليومي بلغة بسيطة.' },
];

interface AuthLayoutProps {
  title: string;
  subtitle: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** A short line above the title, e.g. the step of a two-step form */
  eyebrow?: ReactNode;
  /** The tab title */
  pageTitle?: string;
  /** The page's icon, in a badge above the title */
  icon?: Icon;
}

/**
 * The frame of the sign-in, sign-up and password pages: the form in a card on the reading side, and
 * on wide screens a brand panel with what Serva does. Colours are theme tokens only.
 */
export function AuthLayout({
  title,
  subtitle,
  footer,
  children,
  eyebrow,
  pageTitle,
  icon: PageIcon,
}: AuthLayoutProps) {
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {pageTitle ? <title>{pageTitle}</title> : null}
      <main className="relative flex min-h-dvh flex-col overflow-hidden px-4 pt-4 pb-6 sm:px-8 lg:px-12">
        {/* A soft brand glow behind the card */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(ellipse_60%_55%_at_50%_0%,var(--color-brand-soft),transparent)]"
        />
        <header className="relative flex items-center justify-between">
          <Link to="/" className="flex min-h-12 items-center rounded-control" aria-label="سيرفا">
            <Logo />
          </Link>
        </header>

        <div className="relative mx-auto flex w-full max-w-[28rem] flex-1 flex-col justify-center py-8 motion-safe:animate-rise">
          <div className="relative sm:overflow-hidden sm:rounded-[1.75rem] sm:bg-surface sm:px-10 sm:pt-10 sm:pb-9 sm:shadow-e3 sm:ring-1 sm:ring-line">
            {/* The brand edge along the top of the card */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 hidden h-1.5 bg-[linear-gradient(90deg,var(--color-brand-soft),var(--color-brand),var(--color-brand-soft))] sm:block"
            />
            {PageIcon ? (
              <span
                aria-hidden="true"
                className="mb-5 grid size-14 place-items-center rounded-2xl bg-brand text-on-brand shadow-e2 ring-4 ring-brand-soft"
              >
                <PageIcon size={24} />
              </span>
            ) : null}
            {eyebrow ? <div className="mb-5">{eyebrow}</div> : null}
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
            <p className="mt-2 leading-relaxed text-ink-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
          <div className="mt-6 text-center text-ink-muted">{footer}</div>
        </div>

        <footer className="relative flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-subtle">
          <ShieldCheckIcon size={16} />
          <span>اتصال آمن، وبيانات كل متجر معزولة عن غيره.</span>
        </footer>
      </main>

      <BrandPanel />
    </div>
  );
}

function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="sticky top-0 hidden h-dvh overflow-hidden bg-brand text-on-brand lg:flex lg:flex-col"
    >
      {/* Decoration: a soft dot grid and the logo's «S», drawn large and faint. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-on-brand)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.08]" />
      <svg
        viewBox="0 0 64 64"
        className="pointer-events-none absolute -bottom-24 -left-24 size-[28rem] opacity-[0.07]"
        focusable="false"
      >
        <path d={LOGO_S_PATH} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-on-brand" />
      </svg>

      <div className="relative flex flex-1 flex-col justify-center gap-10 p-12 xl:p-16">
        <div className="flex max-w-lg flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-on-brand/12 px-3 py-1 text-sm font-semibold">
            <span className="size-2 rounded-full bg-on-brand" />
            كاشير سحابي عربي
          </span>
          <p className="text-3xl font-bold xl:text-[2.5rem] xl:leading-[3.25rem]">كل محلّك في شاشة واحدة</p>
          <p className="text-lg opacity-85">بيع، مخزون، ديون الزبائن والموردين، وتقارير يومك، دون محاسب.</p>
        </div>

        <PreviewCard />

        <ul className="grid max-w-lg gap-5">
          {BENEFITS.map(({ icon: BenefitIcon, title, text }) => (
            <li key={title} className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-on-brand/12">
                <BenefitIcon />
              </span>
              <span className="flex flex-col">
                <span className="font-semibold">{title}</span>
                <span className="text-sm opacity-80">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** Sales through the day, a still picture: one series, so no legend; the title names it. */
const SALES = [8, 14, 11, 22, 19, 30, 27, 41, 36, 52, 48, 66];
const CHART_W = 320;
const CHART_H = 96;

function salesPath() {
  const max = Math.max(...SALES);
  const pts: [number, number][] = SALES.map((v, i) => [
    (i / (SALES.length - 1)) * CHART_W,
    CHART_H - 6 - (v / max) * (CHART_H - 18),
  ]);
  // A smooth curve through the points (Catmull-Rom as cubic Béziers).
  let line = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i]!;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const [x3, y3] = pts[i + 2] ?? pts[i + 1]!;
    line += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return { line, area: `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`, end: pts.at(-1)! };
}

const STATS = [
  { label: 'الفواتير', value: '86' },
  { label: 'متوسط الفاتورة', value: '14,520' },
  { label: 'الربح', value: '312,400' },
];

/** A still picture of the owner's day, as the dashboard shows it once signed in. */
function PreviewCard() {
  const gradientId = useId();
  const { line, area, end } = salesPath();
  return (
    <div className="relative max-w-lg pb-12">
      {/* Depth: a second sheet peeking out under the card */}
      <div className="absolute inset-x-8 top-6 bottom-9 rounded-card bg-on-brand/12 ring-1 ring-on-brand/15" />

      <div className="relative rounded-card bg-surface p-6 text-ink shadow-e3 ring-1 ring-on-brand/20">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LogoMark className="size-10" />
            <div className="flex flex-col">
              <span className="font-semibold">بوتيك الأناقة</span>
              <span className="text-xs text-ink-muted">الفرع الرئيسي · الوردية مفتوحة</span>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success-ink">
            <span className="relative flex size-2">
              <span className="absolute inset-0 rounded-full bg-success opacity-60 motion-safe:animate-ping" />
              <span className="relative size-2 rounded-full bg-success" />
            </span>
            مباشر
          </span>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4 border-t border-line pt-5">
          <div>
            <p className="text-sm text-ink-muted">مبيعات اليوم</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span dir="ltr" className="text-kpi font-bold tracking-tight tabular-nums">
                1,248,500
              </span>
              <span className="text-sm font-semibold text-ink-muted">ل.س</span>
            </p>
          </div>
          <span className="mb-1 flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success-ink">
            <TrendUpIcon size={16} />
            <span dir="ltr">12%</span> عن أمس
          </span>
        </div>

        <div className="mt-4" dir="ltr">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="h-24 w-full overflow-visible"
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className="[stop-color:var(--color-brand)] [stop-opacity:0.22]" />
                <stop offset="100%" className="[stop-color:var(--color-brand)] [stop-opacity:0]" />
              </linearGradient>
            </defs>
            {[0.33, 0.66].map((f) => (
              <line
                key={f}
                x1="0"
                x2={CHART_W}
                y1={CHART_H * f}
                y2={CHART_H * f}
                strokeDasharray="3 5"
                className="stroke-line"
              />
            ))}
            <path d={area} fill={`url(#${gradientId})`} />
            <path d={line} fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-brand" />
            <circle cx={end[0]} cy={end[1]} r="6" strokeWidth="2.5" className="fill-brand stroke-surface" />
          </svg>
          <div className="mt-1.5 flex justify-between text-xs text-ink-subtle">
            <span>9 ص</span>
            <span>12 م</span>
            <span>3 م</span>
            <span>6 م</span>
            <span>الآن</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl bg-surface-muted px-3 py-2.5">
              <p className="text-xs text-ink-muted">{s.label}</p>
              <p dir="ltr" className="mt-0.5 text-end font-bold tabular-nums">
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Floating: the connection, and the receipt that just printed */}
      <div className="absolute -top-4 -left-4 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-e2">
        <span className="size-2 rounded-full bg-success" />
        متصل · كل شيء أُرسل
      </div>
      <div className="absolute bottom-0 -left-6 flex items-center gap-3 rounded-2xl bg-surface py-2.5 ps-2.5 pe-4 text-ink shadow-e3 ring-1 ring-line motion-safe:animate-rise xl:-left-10">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-ink">
          <PrintIcon />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold">فاتورة #1045 طُبعت</span>
          <span className="text-xs text-ink-muted">3 قطع · نقداً · 42,000 ل.س</span>
        </span>
      </div>
    </div>
  );
}
