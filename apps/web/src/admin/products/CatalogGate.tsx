import type { ReactNode } from 'react';
import type { MeResponse } from '@serva/core';
import { Card, LockIcon } from '@serva/ui';
import { EmptyState } from './shared';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { canManageCatalog } from '../catalog/catalog';

/** Who may open the catalog screens: the server's rule (owner, manager, or catalog.manage) */
export function canReadCatalog(me: MeResponse): boolean {
  return canManageCatalog(me) || me.user.roles.some((r) => r.key === 'owner' || r.key === 'manager');
}

/** The accountant reads the list and the card (stock, price, cost); he never writes them: the server's rule too */
export function canViewCatalog(me: MeResponse): boolean {
  return canReadCatalog(me) || me.user.permissions.includes('accounting.view');
}

/** «ليست لك»: shown instead of a screen whose every call would answer 403 */
export function NoCatalogAccess() {
  return (
    <Card>
      <EmptyState
        icon={LockIcon}
        title="هذه الشاشة ليست ضمن صلاحياتك."
        description="المنتجات والأسعار يديرها المالك والمدير. اطلب ذلك من صاحب المتجر إن احتجته في عملك."
      />
    </Card>
  );
}

/** Renders the screen only for a user who can read the catalog, so nothing is asked for in vain */
export function CatalogGate({ children, viewOnly }: { children: ReactNode; viewOnly?: boolean }) {
  const me = useMe();
  return (viewOnly ? canViewCatalog(me) : canReadCatalog(me)) ? <>{children}</> : <NoCatalogAccess />;
}

/** A page that builds its own shell: the same gate in front of it */
export function GatedPage({ children, viewOnly }: { children: ReactNode; viewOnly?: boolean }) {
  const me = useMe();
  return (viewOnly ? canViewCatalog(me) : canReadCatalog(me)) ? (
    <>{children}</>
  ) : (
    <AppShell>
      <NoCatalogAccess />
    </AppShell>
  );
}
