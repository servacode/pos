import type { ReactNode } from 'react';
import { CURRENCIES, sectorLabel, type MeResponse } from '@serva/core';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { cn } from '../lib/cn';
import { firstName, formatDays } from '../lib/format';
import { Badge, SoonBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { GiftIcon, MessageIcon, PackagePlusIcon, PrinterIcon, UserPlusIcon, type Icon } from '../ui/icons';

const NEXT_STEPS: readonly { title: string; description: string; icon: Icon }[] = [
  {
    title: 'أضف منتجاتك',
    description: 'بالباركود أو يدوياً، مع السعر بالليرة أو الدولار.',
    icon: PackagePlusIcon,
  },
  { title: 'أضف موظفيك', description: 'حدّد لكل موظف ما يقدر يعمله.', icon: UserPlusIcon },
  { title: 'اربط الطابعة', description: 'اطبع الإيصالات على طابعتك الحرارية.', icon: PrinterIcon },
  { title: 'اربط واتساب', description: 'أرسل الفاتورة للزبون برسالة.', icon: MessageIcon },
];

function trialMessage(daysLeft: number, numberFormat: MeResponse['settings']['numberFormat']): string {
  if (daysLeft <= 0) return 'تنتهي الباقة المجانية اليوم';
  return `باقي ${formatDays(daysLeft, numberFormat)} من الباقة المجانية`;
}

function TrialBanner({ me }: { me: MeResponse }) {
  const { status, daysLeft } = me.subscription;
  if (status !== 'trialing') return null;
  const endingSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-card border px-4 py-4 sm:px-5',
        endingSoon
          ? 'border-warning-ink/20 bg-warning-soft text-warning-ink'
          : 'border-brand/20 bg-brand-soft text-brand-ink',
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface/70">
        <GiftIcon />
      </span>
      <div className="flex min-w-0 flex-col">
        <p className="font-semibold">
          {daysLeft === null ? 'أنت على الباقة المجانية' : trialMessage(daysLeft, me.settings.numberFormat)}
        </p>
        <p className="text-sm opacity-85">كل المزايا متاحة لك خلال التجربة.</p>
      </div>
    </div>
  );
}

function WelcomeCard({ me }: { me: MeResponse }) {
  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">متجرك جاهز، {firstName(me.user.fullName)}</h1>
        <p className="text-ink-muted">خطوات بسيطة تجهّز متجرك للبيع. نشتغل عليها الآن وتتوفر لك قريباً.</p>
      </div>
      <ol className="-my-4 flex flex-col divide-y divide-line sm:my-0 sm:rounded-control sm:border sm:border-line">
        {NEXT_STEPS.map(({ title, description, icon: StepIcon }) => (
          <li key={title} className="flex items-center gap-4 py-4 sm:px-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-ink">
              <StepIcon />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                {title}
                <SoonBadge />
              </p>
              <p className="text-sm text-ink-muted">{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function StoreCard({ me }: { me: MeResponse }) {
  const base = CURRENCIES[me.settings.baseCurrency];
  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg font-bold text-ink">متجرك</h2>
      <dl className="flex flex-col gap-5">
        <InfoRow label="نشاط المتجر">
          <ul className="flex flex-wrap gap-2" aria-label="نشاط المتجر">
            {me.tenant.sectors.map((sector) => (
              <li key={sector}>
                <Badge tone="brand" className="px-3 py-1 text-sm">
                  {sectorLabel(sector)}
                </Badge>
              </li>
            ))}
          </ul>
        </InfoRow>
        <InfoRow label="العملة الأساسية">
          <span className="font-semibold">{base.nameAr}</span>{' '}
          <span className="text-ink-muted">({base.symbolAr})</span>
        </InfoRow>
        <InfoRow label="العملات المفعّلة">
          {me.settings.enabledCurrencies.map((code) => CURRENCIES[code].nameAr).join('، ')}
        </InfoRow>
        {me.branches.length > 0 ? (
          <InfoRow label={me.branches.length > 1 ? 'الفروع' : 'الفرع'}>
            {me.branches.map((branch) => branch.name).join('، ')}
          </InfoRow>
        ) : null}
      </dl>
    </Card>
  );
}

export function HomePage() {
  const me = useMe();
  return (
    <AppShell>
      <div className="flex flex-col gap-6 motion-safe:animate-rise">
        <TrialBanner me={me} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <WelcomeCard me={me} />
          <StoreCard me={me} />
        </div>
      </div>
    </AppShell>
  );
}
