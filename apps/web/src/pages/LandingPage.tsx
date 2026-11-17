import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SECTORS, type PlanRow } from '@serva/core';
import {
  BarcodeIcon,
  Button,
  Card,
  CashIcon,
  CheckIcon,
  IconChip,
  Logo,
  Money,
  OfflineIcon,
  ReportsIcon,
  StoreIcon,
  ThemeToggle,
  UserIcon,
  type Icon,
} from '@serva/ui';
import { limitLines } from '../admin/subscription/planLimits';
import { apiFetch } from '../lib/api';

const WHAT: readonly { icon: Icon; title: string; text: string }[] = [
  { icon: BarcodeIcon, title: 'بيع سريع', text: 'امسح الباركود وخذ المبلغ واطبع الإيصال بضغطات قليلة.' },
  {
    icon: OfflineIcon,
    title: 'يكمل عند انقطاع الإنترنت',
    text: 'يبقى الكاشير يبيع، وتُرسل الفواتير وحدها حين يعود الاتصال.',
  },
  { icon: CashIcon, title: 'ليرة ودولار', text: 'ادفع وأعطِ الباقي بالعملتين، بسعر صرف تحدده أنت.' },
  {
    icon: StoreIcon,
    title: 'مخزونك بين يديك',
    text: 'الكميات والمقاسات والألوان والفروع، وتنبيه حين ينقص صنف.',
  },
  {
    icon: UserIcon,
    title: 'موظفوك بصلاحيات',
    text: 'كل كاشير برمزه، وتعرف من باع ومن فتح الوردية وكم في الدرج.',
  },
  { icon: ReportsIcon, title: 'أرباحك وديونك', text: 'مبيعات اليوم والأرباح وما على الزبائن، بلغة بسيطة.' },
];

/** The plans a visitor may choose from: the priced and paid ones, in the platform's order */
const paidPlans = (items: readonly PlanRow[]) =>
  items.filter((p) => p.isActive && !p.isFree && p.priceMonthlyMinor !== null);

/**
 * What a visitor who is not signed in sees at «/»: what the program is, the plans with their prices
 * (read from the platform's own plans), and the two doors in, sign up and sign in. Nothing here is a
 * made-up figure: the prices are the ones the subscription page shows after signing up.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch<{ items: PlanRow[] }>('/v1/plans')
      .then((r) => alive && setPlans(r.items))
      .catch(() => alive && setPlans([]));
    return () => {
      alive = false;
    };
  }, []);
  const priced = plans ? paidPlans(plans) : [];
  const trialDays = plans?.find((p) => p.trialDays)?.trialDays ?? null;
  const start = () => navigate('/register');

  return (
    <div className="min-h-dvh bg-canvas">
      <title>سيرفا · كاشير ومخزون لمحلّك</title>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Link to="/" className="flex min-h-12 items-center rounded-control" aria-label="سيرفا">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" onClick={() => navigate('/login')}>
            تسجيل الدخول
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 pt-10 pb-16 sm:px-6">
        <section className="flex flex-col gap-5 motion-safe:animate-rise">
          <h1 className="max-w-xl text-3xl font-bold text-ink">
            كاشير ومخزون ومبيعات لمحلّك، بسيطة وباللغة العربية
          </h1>
          <p className="max-w-xl text-lg text-ink-muted">
            سيرفا برنامج لإدارة محل بيع بالتجزئة: تبيع بسرعة، وتعرف مخزونك وأرباحك، ويعمل على الكمبيوتر
            والجوال.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={start}>
              {trialDays ? `ابدأ مجاناً ${String(trialDays)} يوماً` : 'ابدأ مجاناً'}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigate('/login')}>
              لدي حساب
            </Button>
          </div>
        </section>

        <section aria-labelledby="landing-what" className="flex flex-col gap-4">
          <h2 id="landing-what" className="text-lg font-semibold text-ink">
            ماذا يعطيك
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {WHAT.map(({ icon: WhatIcon, title, text }) => (
              <li key={title} className="flex">
                <Card className="flex w-full flex-col gap-3">
                  <IconChip>
                    <WhatIcon />
                  </IconChip>
                  <h3 className="text-lg font-semibold text-ink">{title}</h3>
                  <p className="text-ink-muted">{text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="landing-types" className="flex flex-col gap-4">
          <h2 id="landing-types" className="text-lg font-semibold text-ink">
            لأي نوع محل
          </h2>
          <ul className="flex flex-wrap gap-2">
            {SECTORS.map((s) => (
              <li
                key={s.key}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink"
              >
                {s.labelAr}
              </li>
            ))}
          </ul>
        </section>

        {priced.length > 0 ? (
          <section aria-labelledby="landing-plans" className="flex flex-col gap-4">
            <h2 id="landing-plans" className="text-lg font-semibold text-ink">
              الباقات
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {priced.map((plan) => (
                <li key={plan.code} className="flex">
                  <Card className="flex w-full flex-col gap-5">
                    <span className="text-lg font-semibold text-ink">{plan.name}</span>
                    <p className="flex items-baseline gap-1.5">
                      <Money
                        minor={plan.priceMonthlyMinor ?? 0}
                        currency="USD"
                        className="text-kpi font-bold tracking-tight text-ink"
                        unitClassName="text-base font-semibold text-ink-subtle"
                      />
                      <span className="text-sm text-ink-muted">/ شهر</span>
                    </p>
                    <ul className="flex flex-1 flex-col gap-2.5 border-t border-line pt-5">
                      {limitLines(plan).map((line) => (
                        <li key={line} className="flex items-center gap-2.5 text-sm text-ink">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
                            <CheckIcon size={16} strokeWidth={3} className="size-3" />
                          </span>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-muted">
              الأسعار بالدولار، وتدفعها بالدولار أو بالليرة عند الاشتراك.
            </p>
          </section>
        ) : null}

        <section className="flex flex-col items-start gap-4 rounded-panel bg-surface-muted p-6">
          <h2 className="text-lg font-semibold text-ink">جرّب على محلّك اليوم</h2>
          <p className="text-ink-muted">رقم جوالك وكلمة سر، وبعدها خطوات قصيرة وتبدأ البيع.</p>
          <Button size="lg" onClick={start}>
            أنشئ حسابك
          </Button>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-5 gap-y-2 px-4 pb-10 text-sm text-ink-muted sm:px-6">
        <Link to="/terms" className="underline underline-offset-4">
          الشروط
        </Link>
        <Link to="/privacy" className="underline underline-offset-4">
          الخصوصية
        </Link>
      </footer>
    </div>
  );
}
