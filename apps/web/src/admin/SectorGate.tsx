import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { SectorKey } from '@serva/core';
import { Card, EmptyState, SettingsIcon } from '@serva/ui';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { storeSells } from '../lib/sectors';

/**
 * A screen of some business types only (expiry, the controlled register, cancellations after the
 * kitchen, serial numbers, cheques): the menu hides it for other stores, and opening its address
 * by hand says so instead of showing a screen the store has no use for.
 */
export function SectorGate({ sectors, children }: { sectors: readonly SectorKey[]; children: ReactNode }) {
  const me = useMe();
  if (storeSells(me.tenant.sectors, sectors)) return children;
  return (
    <AppShell>
      <title>غير متاحة · SERFA</title>
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <EmptyState
            icon={SettingsIcon}
            title="هذه الشاشة لا تخص نشاط محلّك"
            description="تظهر لأنواع أنشطة أخرى. إن كان نشاطك يحتاجها فأضفه من إعدادات المتجر."
            action={
              <Link to="/settings" className="font-semibold text-brand-ink underline underline-offset-4">
                إعدادات المتجر
              </Link>
            }
          />
        </Card>
      </div>
    </AppShell>
  );
}
