import { useEffect, useState } from 'react';
import type { StoreResponse } from '@serva/core';
import {
  Alert,
  Card,
  cn,
  CONTROL_HEIGHT,
  PageHeader,
  SettingsIcon,
  Skeleton,
  SkeletonText,
  useDensity,
} from '@serva/ui';
import { useAuth, useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import {
  EXPIRY_SECTORS,
  MEDICINAL_SECTORS,
  MODIFIER_SECTORS,
  storeSells,
  WEIGHED_SECTORS,
} from '../../lib/sectors';
import { getStore } from './api';
import { DataCard } from './DataCard';
import { PharmacyForm } from './PharmacyForm';
import { TillForm } from './TillForm';
import { LoyaltyForm } from './LoyaltyForm';
import { SETTINGS_SECTIONS, type SettingsSection } from './parts';
import { ScaleForm } from './ScaleForm';
import { ServiceForm } from './ServiceForm';
import { CurrencyForm, ProfileForm } from './StoreForms';

/**
 * The part of the page in view, for the side list: the first card under the top bar. Only where the
 * browser can watch the page scroll; elsewhere the list marks nothing.
 */
function useSectionInView(ids: readonly string[]): string | undefined {
  const [current, setCurrent] = useState<string>();
  const key = ids.join(' ');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const order = key.split(' ');
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        const first = order.find((id) => seen.has(id));
        if (first) setCurrent(first);
      },
      // The band under the sticky header, down to the middle of the window.
      { rootMargin: '-128px 0px -50% 0px' },
    );
    for (const id of order) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
}

/**
 * The settings' own list (هوية 4 › settings layout): on the start side from 1024 px, staying in
 * view as the page scrolls; above the cards as a row of chips on a phone. Each item leads to its
 * card on the page.
 */
function SettingsNav({ sections }: { sections: readonly SettingsSection[] }) {
  const density = useDensity();
  const current = useSectionInView(sections.map((section) => section.id)) ?? sections[0]?.id;
  return (
    <nav aria-label="أقسام الإعدادات" className="min-w-0 lg:sticky lg:top-32 lg:self-start">
      <ul className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:px-0">
        {sections.map((section) => {
          const SectionIcon = section.icon;
          const active = section.id === current;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={active ? 'location' : undefined}
                className={cn(
                  CONTROL_HEIGHT[density],
                  'flex items-center gap-2.5 rounded-control px-3 text-[0.9375rem] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                  active
                    ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                <SectionIcon size={20} className={active ? 'text-brand' : 'text-ink-subtle'} />
                {section.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The page's shape while the store loads: the side list and two cards of grey lines. */
function SettingsLoading() {
  return (
    <div aria-busy="true" className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
      <span className="sr-only">نحمّل إعدادات المتجر…</span>
      <div className="flex gap-2 lg:flex-col">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-32 lg:w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-6">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index} className="flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9" />
              <Skeleton className="h-5 w-48" />
            </div>
            <SkeletonText lines={4} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * «إعدادات المتجر» (04 › الإعدادات): what the wizard set, changed any time. The owner edits; anyone
 * else signed in sees what is set. The scale and the hall show for the activities that use them
 * (lib/sectors), and stay while they are on.
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

  const weighs = store ? store.scaleBarcode !== null || storeSells(store.sectors, WEIGHED_SECTORS) : false;
  const serves = store ? store.service !== null || storeSells(store.sectors, MODIFIER_SECTORS) : false;
  // Medicine returns and batches: pharmacies and medical supplies; «الدفعات والصلاحية» for the other stores with expiry dates
  const medicinal = store ? storeSells(store.sectors, MEDICINAL_SECTORS) : false;
  const batches = store
    ? medicinal || store.pharmacy !== null || storeSells(store.sectors, EXPIRY_SECTORS)
    : false;
  const sections: SettingsSection[] = [
    SETTINGS_SECTIONS.profile,
    SETTINGS_SECTIONS.currency,
    ...(weighs ? [SETTINGS_SECTIONS.scale] : []),
    ...(serves ? [SETTINGS_SECTIONS.service] : []),
    SETTINGS_SECTIONS.till,
    ...(batches ? [medicinal ? SETTINGS_SECTIONS.pharmacy : SETTINGS_SECTIONS.batches] : []),
    SETTINGS_SECTIONS.loyalty,
    SETTINGS_SECTIONS.data,
  ];

  return (
    <AppShell>
      <title>إعدادات المتجر · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="إعدادات المتجر"
          description="ما اخترته في معالج البداية، تغيّره متى شئت. كل قسم يُحفظ وحده."
          icon={<SettingsIcon />}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!canEdit ? <Alert tone="info">هذه الإعدادات يغيّرها المالك فقط.</Alert> : null}
        {!store && !error ? <SettingsLoading /> : null}
        {store && canEdit ? (
          <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
            <SettingsNav sections={sections} />
            <div className="flex min-w-0 flex-col gap-6">
              <ProfileForm store={store} onSaved={saved} section={SETTINGS_SECTIONS.profile} />
              <CurrencyForm store={store} onSaved={saved} section={SETTINGS_SECTIONS.currency} />
              {weighs ? <ScaleForm store={store} onSaved={saved} /> : null}
              {serves ? <ServiceForm store={store} onSaved={saved} /> : null}
              <TillForm store={store} onSaved={saved} />
              {batches ? <PharmacyForm store={store} onSaved={saved} /> : null}
              <LoyaltyForm store={store} onSaved={saved} />
              <DataCard />
            </div>
          </div>
        ) : null}
        {store && !canEdit ? (
          <Card className="max-w-xl">
            <dl className="flex flex-col divide-y divide-line">
              <div className="flex items-center justify-between gap-4 pb-3">
                <dt className="text-sm text-ink-muted">اسم المحل</dt>
                <dd className="font-semibold text-ink">{store.name}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 pt-3">
                <dt className="text-sm text-ink-muted">سعر الدولار</dt>
                <dd className="num font-semibold text-ink">{store.usdRate ?? '—'}</dd>
              </div>
            </dl>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
