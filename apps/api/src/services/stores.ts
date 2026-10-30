import { sql } from 'drizzle-orm';
import { DEFAULT_ROLES, type RegisterStoreData } from '@serva/core';
import {
  branches,
  registers,
  roles,
  tenantSettings,
  tenants,
  userRoles,
  users,
  uuidv7,
  withTenant,
  type Database,
} from '@serva/db';
import { AppError, isUniqueViolation } from '../errors';
import { audit } from './audit';
import { createSession, type IssuedSession, type SessionPolicy } from './sessions';
import type { RequestMeta } from '../types';

export interface RegisteredStore {
  session: IssuedSession;
  user: { id: string; fullName: string; phone: string | null };
  tenant: { id: string; name: string };
}

/**
 * Opens a new store in one transaction: store, settings, free-plan subscription, main branch,
 * first register, default roles, owner account and a login session.
 */
export async function registerStore(
  db: Database,
  data: RegisterStoreData,
  passwordHash: string,
  options: { sessionPolicy: SessionPolicy; now: Date },
  meta: RequestMeta,
): Promise<RegisteredStore> {
  const tenantId = uuidv7();
  try {
    return await withTenant(db, tenantId, async (tx) => {
      const { now } = options;
      const otherCurrencies = (['SYP', 'USD'] as const).filter((c) => c !== data.baseCurrency);

      await tx.insert(tenants).values({
        id: tenantId,
        name: data.storeName,
        sectors: data.sectors,
        referralCode: data.agentCode ?? null,
      });
      await tx.insert(tenantSettings).values({
        tenantId,
        baseCurrency: data.baseCurrency,
        enabledCurrencies: [data.baseCurrency, ...otherCurrencies],
      });
      // Billing rows are not writable by the store role; this starts the default plan's trial.
      await tx.execute(sql`select subscription_start_trial(${now.toISOString()}::timestamptz)`);

      const [branch] = await tx
        .insert(branches)
        .values({ tenantId, code: '01', name: 'الفرع الرئيسي' })
        .returning({ id: branches.id });
      await tx.insert(registers).values({ tenantId, branchId: branch!.id, code: '01', name: 'الجهاز 1' });

      const createdRoles = await tx
        .insert(roles)
        .values(
          DEFAULT_ROLES.map((r) => ({
            tenantId,
            key: r.key,
            name: r.nameAr,
            permissions: [...r.permissions],
            maxDiscountBp: r.maxDiscountBp,
            isSystem: true,
          })),
        )
        .returning({ id: roles.id, key: roles.key });
      const ownerRole = createdRoles.find((r) => r.key === 'owner')!;

      const [user] = await tx
        .insert(users)
        .values({ tenantId, fullName: data.ownerName, phone: data.phone, passwordHash, lastLoginAt: now })
        .returning({ id: users.id, fullName: users.fullName, phone: users.phone });
      await tx.insert(userRoles).values({ tenantId, userId: user!.id, roleId: ownerRole.id, branchId: null });

      const session = await createSession(
        tx,
        { tenantId, userId: user!.id, now, policy: options.sessionPolicy },
        meta,
      );
      await audit(
        tx,
        {
          tenantId,
          userId: user!.id,
          action: 'store.registered',
          entity: 'tenant',
          entityId: tenantId,
          data: { sectors: data.sectors },
        },
        meta,
      );

      return { session, user: user!, tenant: { id: tenantId, name: data.storeName } };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_phone_unique')) {
      throw new AppError(409, 'phone_taken', 'هذا الرقم مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.', {
        phone: 'هذا الرقم مسجّل مسبقاً',
      });
    }
    throw error;
  }
}
