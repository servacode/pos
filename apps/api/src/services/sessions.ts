import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sessions, users, withTenant, type Database, type Transaction } from '@serva/db';
import { hashRefreshToken, newRefreshToken } from '../auth/tokens';
import type { RequestMeta } from '../types';

export interface IssuedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  refreshToken: string;
  expiresAt: Date;
}

/** A revoked token used again within this window is treated as a race between tabs, not theft. */
const REUSE_GRACE_MS = 30_000;

export async function createSession(
  tx: Transaction,
  input: { tenantId: string; userId: string; ttlDays: number },
  meta: RequestMeta,
): Promise<IssuedSession> {
  const sessionId = randomUUID();
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + input.ttlDays * 86_400_000);
  await tx.insert(sessions).values({
    id: sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    tokenHash: hash,
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt,
  });
  return { sessionId, userId: input.userId, tenantId: input.tenantId, refreshToken: token, expiresAt };
}

/**
 * Exchanges a refresh token for a new one (rotation). Returns null when the token is unknown,
 * expired, revoked, or the user is disabled. Reusing an old token after the grace window
 * revokes every session of that user.
 */
export async function rotateSession(
  db: Database,
  refreshToken: string,
  ttlDays: number,
  meta: RequestMeta,
): Promise<IssuedSession | null> {
  const [current] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashRefreshToken(refreshToken)))
    .limit(1);
  if (!current) return null;

  if (current.revokedAt) {
    if (Date.now() - current.revokedAt.getTime() > REUSE_GRACE_MS) {
      await revokeAllForUser(db, current.userId);
    }
    return null;
  }
  if (current.expiresAt.getTime() <= Date.now()) return null;

  return withTenant(db, current.tenantId, async (tx) => {
    const [user] = await tx
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, current.userId))
      .limit(1);
    if (!user || user.status !== 'active') {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, current.id));
      return null;
    }
    const next = await createSession(
      tx,
      { tenantId: current.tenantId, userId: current.userId, ttlDays },
      meta,
    );
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), replacedBy: next.sessionId })
      .where(and(eq(sessions.id, current.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) {
      // Another request rotated this token first; undo ours.
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, next.sessionId));
      return null;
    }
    return next;
  });
}

export async function revokeSession(db: Database, refreshToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashRefreshToken(refreshToken)), isNull(sessions.revokedAt)));
}

async function revokeAllForUser(db: Database, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
