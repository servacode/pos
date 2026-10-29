import { eq } from 'drizzle-orm';
import {
  ALL_PERMISSIONS,
  type CurrencyCode,
  type MeResponse,
  type Permission,
  type SectorKey,
} from '@serva/core';
import {
  branches,
  plans,
  roles,
  subscriptions,
  tenantSettings,
  tenants,
  userRoles,
  users,
  withTenant,
  type Database,
} from '@serva/db';
import type { AccessClaims } from '../auth/tokens';
import { unauthorized } from '../errors';

const DAY_MS = 86_400_000;

export function daysLeft(end: Date | null, now = new Date()): number | null {
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

export async function loadMe(db: Database, auth: AccessClaims): Promise<MeResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    if (!user || user.status !== 'active') throw unauthorized();

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1);
    const [settings] = await tx.select().from(tenantSettings).limit(1);
    const [sub] = await tx
      .select({ subscription: subscriptions, planName: plans.name })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .limit(1);
    if (!tenant || !settings || !sub) throw unauthorized();

    const roleRows = await tx
      .select({
        key: roles.key,
        name: roles.name,
        permissions: roles.permissions,
        branchId: userRoles.branchId,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, user.id));
    const granted = new Set(roleRows.flatMap((r) => r.permissions));
    const permissions = ALL_PERMISSIONS.filter((p): p is Permission => granted.has(p));

    const branchRows = await tx
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.code);

    const s = sub.subscription;
    const periodEnd = s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd;
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        roles: roleRows.map((r) => ({ key: r.key, name: r.name, branchId: r.branchId })),
        permissions,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        sectors: tenant.sectors as SectorKey[],
        country: tenant.country,
        timezone: tenant.timezone,
      },
      settings: {
        baseCurrency: settings.baseCurrency as CurrencyCode,
        enabledCurrencies: settings.enabledCurrencies as CurrencyCode[],
        taxInclusive: settings.taxInclusive,
        numberFormat: settings.numberFormat === 'arab' ? 'arab' : 'latn',
      },
      subscription: {
        status: s.status,
        planName: sub.planName,
        trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
        daysLeft: daysLeft(periodEnd),
      },
      branches: branchRows,
    };
  });
}
