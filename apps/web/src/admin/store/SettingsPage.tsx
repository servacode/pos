import { useEffect, useState } from 'react';
import type { StoreResponse } from '@serva/core';
import { Alert, FullScreenLoader } from '@serva/ui';
import { useAuth, useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { getStore } from './api';
import { CurrencyForm, ProfileForm } from './StoreForms';

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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-bold text-ink">إعدادات المتجر</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!canEdit ? <Alert tone="info">هذه الإعدادات يغيّرها المالك فقط.</Alert> : null}
        {!store && !error ? <FullScreenLoader /> : null}
        {store && canEdit ? (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">المحل والفاتورة</h2>
              <ProfileForm store={store} onSaved={saved} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">العملة وسعر الصرف</h2>
              <CurrencyForm store={store} onSaved={saved} />
            </section>
          </>
        ) : null}
        {store && !canEdit ? (
          <dl className="grid gap-2 text-ink">
            <dt className="text-ink-muted">اسم المحل</dt>
            <dd className="font-semibold">{store.name}</dd>
            <dt className="text-ink-muted">سعر الدولار</dt>
            <dd className="num font-semibold">{store.usdRate ?? '—'}</dd>
          </dl>
        ) : null}
      </div>
    </AppShell>
  );
}
