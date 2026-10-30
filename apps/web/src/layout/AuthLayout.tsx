import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon, Logo } from '@serva/ui';

const BENEFITS = [
  'بيع سريع وإيصال واضح بضغطة زر',
  'الليرة السورية والدولار جاهزان من أول يوم',
  'مخزونك وأرباحك بلغة بسيطة، دون محاسبة معقدة',
];

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, footer, children }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <main className="flex min-h-dvh flex-col px-4 pt-4 pb-12 sm:px-8 lg:px-12">
        <Link to="/" className="flex min-h-12 items-center self-start rounded-control" aria-label="سيرفا">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col pt-8 sm:justify-center motion-safe:animate-rise">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-2 text-ink-muted">{subtitle}</p>
          <div className="mt-6 sm:rounded-card sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-e1">
            {children}
          </div>
          <p className="mt-6 text-center text-ink-muted">{footer}</p>
        </div>
      </main>

      <aside className="sticky top-0 hidden h-dvh flex-col justify-center border-s border-line bg-surface p-12 lg:flex">
        <div className="flex max-w-md flex-col gap-8">
          <p className="text-2xl font-bold text-ink">كاشير سحابي بسيط، مصمّم لمحلّك</p>
          <ul className="flex flex-col gap-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-center gap-3 text-lg text-ink">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
                  <CheckIcon />
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
