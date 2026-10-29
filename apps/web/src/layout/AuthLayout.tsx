import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../ui/Logo';
import { CheckIcon } from '../ui/icons';

const BENEFITS = [
  'بيع سريع وإيصال واضح بضغطة زر',
  'الليرة السورية والدولار جاهزان من أول يوم',
  'مخزونك وأرباحك بلغة بسيطة، بدون محاسبة معقدة',
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
      <main className="flex min-h-dvh flex-col px-4 pt-5 pb-10 sm:px-8 lg:px-12">
        <Link to="/" className="self-start rounded-control" aria-label="Serva POS">
          <Logo markClassName="size-9" />
        </Link>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col pt-10 sm:justify-center sm:pt-8 motion-safe:animate-rise">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 text-ink-muted">{subtitle}</p>
          <div className="mt-7 sm:rounded-card sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-card">
            {children}
          </div>
          <p className="mt-7 text-center text-ink-muted">{footer}</p>
        </div>
      </main>

      <aside className="sticky top-0 hidden h-dvh overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden="true"
          className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-brand-500/35 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -right-32 -bottom-40 size-[30rem] rounded-full bg-brand-700/60 blur-3xl"
        />
        <div className="relative flex max-w-md flex-col gap-8">
          <p className="text-3xl leading-snug font-bold">كاشير سحابي بسيط، مصمّم لمحلّك</p>
          <ul className="flex flex-col gap-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-lg text-brand-50">
                <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-white/15">
                  <CheckIcon strokeWidth={2.5} className="size-3.5" />
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
