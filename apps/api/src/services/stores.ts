import { sql } from 'drizzle-orm';
import { DEFAULT_ROLES } from '@serva/core';
import {
  branches,
  legalAcceptances,
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

/** A sign-up whose phone has just been verified. */
export interface VerifiedSignUp {
  phone: string;
  fullName: string;
  /** Verified agent, when a valid code was given */
  agentId: string | null;
  termsVersion: string;
}

/** Until the setup wizard asks (04): the store's name on receipts and its base currency. */
export const temporaryStoreName = (fullName: string) => `متجر ${fullName}`.slice(0, 80);

/**
 * Opens a new store in one transaction, once the owner's phone is verified: store, settings,
 * 30-day trial, main branch, default roles, owner account, accepted terms and a login session.
 * Business type and currency are set by the setup wizard; no device is created here (a device
 * code is reserved when the first device is activated).
 */
export async function registerStore(
  db: Database,
  signUp: VerifiedSignUp,
  passwordHash: string,
  options: { sessionPolicy: SessionPolicy; now: Date },
  meta: RequestMeta,
): Promise<RegisteredStore> {
  const tenantId = uuidv7();
  const storeName = temporaryStoreName(signUp.fullName);
  try {
    return await withTenant(db, tenantId, async (tx) => {
      const { now } = options;
      await tx
        .insert(tenants)
        .values({ id: tenantId, name: storeName, sectors: [], agentId: signUp.agentId });
      await tx
        .insert(tenantSettings)
        .values({ tenantId, baseCurrency: 'SYP', enabledCurrencies: ['SYP', 'USD'] });
      // Billing rows are not writable by the store role; this starts the default plan's trial.
      await tx.execute(sql`select subscription_start_trial(${now.toISOString()}::timestamptz)`);

      await tx.insert(branches).values({ tenantId, code: '01', name: 'الفرع الرئيسي' });

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
        .values({ tenantId, fullName: signUp.fullName, phone: signUp.phone, passwordHash, lastLoginAt: now })
        .returning({ id: users.id, fullName: users.fullName, phone: users.phone });
      await tx.insert(userRoles).values({ tenantId, userId: user!.id, roleId: ownerRole.id, branchId: null });
      await tx.insert(legalAcceptances).values({
        tenantId,
        userId: user!.id,
        document: 'terms',
        documentVersion: signUp.termsVersion,
        context: 'registration',
        ip: meta.ip,
        userAgent: meta.userAgent,
        createdAt: now,
      });

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
          data: { agentId: signUp.agentId, termsVersion: signUp.termsVersion },
        },
        meta,
      );

      return { session, user: user!, tenant: { id: tenantId, name: storeName } };
    });
  } catch (error) {
    // Reached only after the code was confirmed, so telling the phone's owner is safe.
    if (isUniqueViolation(error, 'users_phone_unique')) {
      throw new AppError(409, 'phone_taken', 'لديك حساب بهذا الرقم. سجّل الدخول بدلاً من ذلك.', {
        phone: 'لديك حساب بهذا الرقم',
      });
    }
    throw error;
  }
}
