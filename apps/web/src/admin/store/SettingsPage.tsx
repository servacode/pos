import { useEffect, useState, type ReactNode } from 'react';
import type { StoreResponse } from '@serva/core';
import {
  Alert,
  Card,
  CashIcon,
  FullScreenLoader,
  GiftIcon,
  PageHeader,
  PrintIcon,
  SettingsIcon,
  StoreIcon,
  WeighedIcon,
  type Icon,
} from '@serva/ui';
import { useAuth, useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getStore } from './api';
import { LoyaltyForm } from './LoyaltyForm';
import { ScaleForm } from './ScaleForm';
import { ServiceForm } from './ServiceForm';
import { CurrencyForm, ProfileForm } from './StoreForms';

interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: Icon;
}

const SECTIONS: SettingsSection[] = [
  {
    id: 'profile',
    title: 'المحل والفاتورة',
    description: 'اسم المحل وعنوانه وما يُطبع في رأس الفاتورة وأسفلها.',
    icon: StoreIcon,
  },
  {
    id: 'currency',
    title: 'العملة وسعر الصرف',
    description: 'الدولار وسعره اليوم، وهل أسعار الرفوف تشمل الضريبة.',
    icon: CashIcon,
  },
  {
    id: 'scale',
    title: 'باركود الميزان',
    description: 'اجعل الكاشير يقرأ الصنف ووزنه من ملصق الميزان.',
    icon: WeighedIcon,
  },
  {
    id: 'service',
    title: 'الصالة والمطبخ',
    description: 'أنواع الطلب والطاولات وورقة المطبخ للمطاعم والمقاهي.',
    icon: PrintIcon,
  },
  {
    id: 'loyalty',
    title: 'نقاط الولاء',
    description: 'كم يجمع الزبون من نقاط، وكم تساوي النقطة عند الصرف.',
    icon: GiftIcon,
  },
];

/** A section of the settings: its icon, name and line, then the form that saves it. */
function SettingsBlock({ section, children }: { section: SettingsSection; children: ReactNode }) {
  const BlockIcon = section.icon;
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      className="flex scroll-mt-6 flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink"
        >
          <BlockIcon />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${section.id}-title`} className="text-lg font-semibold text-ink">
            {section.title}
          </h2>
          <p className="text-sm text-ink-muted">{section.description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * «إعدادات المتجر» (04 › الإعدادات): what the wizard set, changed any time. The owner edits; anyone
 * else signed in sees what is set.
 */
export function SettingsPage() {
  const me = useMe();
  const { refreshMe } = useAuth();
  const canEdit = me.user.permissions.includes('settings.manage');
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStore()
      .then((s) => alive && setStore(s))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  const saved = (s: StoreResponse) => {
    setStore(s);
    void refreshMe();
  };

  return (
    <AppShell>
      <title>إعدادات المتجر · Serva POS</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={SettingsIcon}
          title="إعدادات المتجر"
          description="ما ضبطته عند البداية، تغيّره في أي وقت. لكل قسم زر حفظ خاص به."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!canEdit ? <Alert tone="info">هذه الإعدادات يغيّرها المالك فقط.</Alert> : null}
        {!store && !error ? <FullScreenLoader /> : null}
        {store && canEdit ? (
          <div className="grid gap-8 lg:grid-cols-[13rem_1fr] lg:items-start">
            <nav
              aria-label="أقسام الإعدادات"
              className="scrollbar-none flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:overflow-visible"
            >
              {SECTIONS.map((section) => {
                const NavIcon = section.icon;
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-semibold whitespace-nowrap text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <NavIcon size={16} />
                    {section.title}
                  </a>
                );
              })}
            </nav>
            <div className="flex min-w-0 flex-col gap-10">
              <SettingsBlock section={SECTIONS[0]!}>
                <ProfileForm store={store} onSaved={saved} />
              </SettingsBlock>
              <SettingsBlock section={SECTIONS[1]!}>
                <CurrencyForm store={store} onSaved={saved} />
              </SettingsBlock>
              <SettingsBlock section={SECTIONS[2]!}>
                <ScaleForm store={store} onSaved={saved} />
              </SettingsBlock>
              <SettingsBlock section={SECTIONS[3]!}>
                <ServiceForm store={store} onSaved={saved} />
              </SettingsBlock>
              <SettingsBlock section={SECTIONS[4]!}>
                <LoyaltyForm store={store} onSaved={saved} />
              </SettingsBlock>
            </div>
          </div>
        ) : null}
        {store && !canEdit ? (
          <Card>
            <dl className="grid gap-2 text-ink">
              <dt className="text-ink-muted">اسم المحل</dt>
              <dd className="font-semibold">{store.name}</dd>
              <dt className="text-ink-muted">سعر الدولار</dt>
              <dd className="num font-semibold">{store.usdRate ?? '—'}</dd>
            </dl>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
