import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { sessions, tenants, users, uuidv7, withTenant, type Database, type Transaction } from '@serva/db';
import { hashRefreshToken, newRefreshToken } from '../auth/tokens';
import { DAY_MS } from '../clock';
import type { RequestMeta } from '../types';

export interface IssuedSession {
  /** The session family: stays the same across refreshes and is what access tokens carry */
  sessionId: string;
  /** This refresh token's row */
  rowId: string;
  userId: string;
  tenantId: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface SessionPolicy {
  /** Lifetime of one refresh token */
  ttlDays: number;
  /** End of the whole session family, counted from sign-in; refreshing never extends it */
  absoluteDays: number;
}

/** A rotated token used again within this window is a race between tabs, not theft. */
export const REUSE_GRACE_MS = 30_000;

// Raw rows from db.execute: drizzle hands timestamps back as text.
type StoredSession = {
  id: string;
  tenant_id: string;
  user_id: string;
  family_id: string;
  expires_at: string | Date;
  absolute_expires_at: string | Date;
  revoked_at: string | Date | null;
  replaced_by: string | null;
};

const time = (value: string | Date) => new Date(value).getTime();

/** Finds a session by refresh token, across stores, through the narrow SECURITY DEFINER function. */
async function findByToken(db: Database, refreshToken: string): Promise<StoredSession | undefined> {
  const rows = await db.execute<StoredSession>(
    sql`select * from session_find_by_hash(${hashRefreshToken(refreshToken)})`,
  );
  return rows[0];
}

export async function createSession(
  tx: Transaction,
  input: {
    tenantId: string;
    userId: string;
    now: Date;
    policy: SessionPolicy;
    /** Continue an existing family (rotation); a new family starts otherwise */
    family?: { id: string; absoluteExpiresAt: Date };
  },
  meta: RequestMeta,
): Promise<IssuedSession> {
  const id = uuidv7();
  const { token, hash } = newRefreshToken();
  const now = input.now.getTime();
  const family = input.family ?? {
    id,
    absoluteExpiresAt: new Date(now + input.policy.absoluteDays * DAY_MS),
  };
  const expiresAt = new Date(
    Math.min(now + input.policy.ttlDays * DAY_MS, family.absoluteExpiresAt.getTime()),
  );
  await tx.insert(sessions).values({
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    familyId: family.id,
    tokenHash: hash,
    userAgent: meta.userAgent,
    ip: meta.ip,
    createdAt: input.now,
    expiresAt,
    absoluteExpiresAt: family.absoluteExpiresAt,
  });
  return {
    sessionId: family.id,
    rowId: id,
    userId: input.userId,
    tenantId: input.tenantId,
    refreshToken: token,
    expiresAt,
  };
}

export type RotateResult =
  | { status: 'rotated'; session: IssuedSession }
  /** Another request (another tab) has just rotated this token: retry with the new cookie */
  | { status: 'race' }
  | { status: 'invalid' };

/**
 * Exchanges a refresh token for a new one in the same family. A token reused after the grace
 * window means it was stolen, so every session of that user is ended. Expired families,
 * disabled users and suspended stores get nothing.
 */
export async function rotateSession(
  db: Database,
  refreshToken: string,
  policy: SessionPolicy,
  now: Date,
  meta: RequestMeta,
): Promise<RotateResult> {
  const current = await findByToken(db, refreshToken);
  if (!current) return { status: 'invalid' };

  if (current.revoked_at) {
    if (!current.replaced_by) return { status: 'invalid' }; // signed out or revoked
    if (now.getTime() - time(current.revoked_at) <= REUSE_GRACE_MS) return { status: 'race' };
    await revokeAllForUser(db, current.tenant_id, current.user_id, now);
    return { status: 'invalid' };
  }
  if (time(current.expires_at) <= now.getTime() || time(current.absolute_expires_at) <= now.getTime()) {
    return { status: 'invalid' };
  }

  return withTenant(db, current.tenant_id, async (tx): Promise<RotateResult> => {
    const [owner] = await tx
      .select({ userStatus: users.status, tenantStatus: tenants.status })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, current.user_id))
      .limit(1);
    if (owner?.userStatus !== 'active' || owner.tenantStatus !== 'active') {
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, current.id));
      return { status: 'invalid' };
    }
    const next = await createSession(
      tx,
      {
        tenantId: current.tenant_id,
        userId: current.user_id,
        now,
        policy,
        family: { id: current.family_id, absoluteExpiresAt: new Date(current.absolute_expires_at) },
      },
      meta,
    );
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: now, replacedBy: next.rowId })
      .where(and(eq(sessions.id, current.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) {
      // Another request rotated this token first; void ours and let the client retry.
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, next.rowId));
      return { status: 'race' };
    }
    return { status: 'rotated', session: next };
  });
}

/** Ends the session of this refresh token. Returns its family id, or null when unknown. */
export async function revokeSession(db: Database, refreshToken: string, now: Date): Promise<string | null> {
  const current = await findByToken(db, refreshToken);
  if (!current) return null;
  await withTenant(db, current.tenant_id, (tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.familyId, current.family_id), isNull(sessions.revokedAt))),
  );
  return current.family_id;
}

async function revokeAllForUser(db: Database, tenantId: string, userId: string, now: Date): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))),
  );
}

/**
 * True while the session family is live: not revoked or expired, its user active and its store
 * active. Checked for every access token (through the SessionGate cache).
 */
export async function isSessionLive(
  db: Database,
  claims: { tenantId: string; userId: string; sessionId: string },
  now: Date,
): Promise<boolean> {
  return withTenant(db, claims.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(users, and(eq(users.tenantId, sessions.tenantId), eq(users.id, sessions.userId)))
      .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
      .where(
        and(
          eq(sessions.familyId, claims.sessionId),
          eq(sessions.userId, claims.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
          eq(users.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}
