import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { sessions, users, withTenant, type Database, type Transaction } from '@serva/db';
import { hashRefreshToken, newRefreshToken } from '../auth/tokens';
import { DAY_MS } from '../clock';
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
  input: { tenantId: string; userId: string; ttlDays: number; now: Date },
  meta: RequestMeta,
): Promise<IssuedSession> {
  const sessionId = randomUUID();
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(input.now.getTime() + input.ttlDays * DAY_MS);
  await tx.insert(sessions).values({
    id: sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    tokenHash: hash,
    userAgent: meta.userAgent,
    ip: meta.ip,
    createdAt: input.now,
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
  now: Date,
  meta: RequestMeta,
): Promise<IssuedSession | null> {
  const [current] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashRefreshToken(refreshToken)))
    .limit(1);
  if (!current) return null;

  if (current.revokedAt) {
    if (now.getTime() - current.revokedAt.getTime() > REUSE_GRACE_MS) {
      await revokeAllForUser(db, current.userId, now);
    }
    return null;
  }
  if (current.expiresAt.getTime() <= now.getTime()) return null;

  return withTenant(db, current.tenantId, async (tx) => {
    const [user] = await tx
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, current.userId))
      .limit(1);
    if (!user || user.status !== 'active') {
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, current.id));
      return null;
    }
    const next = await createSession(
      tx,
      { tenantId: current.tenantId, userId: current.userId, ttlDays, now },
      meta,
    );
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: now, replacedBy: next.sessionId })
      .where(and(eq(sessions.id, current.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) {
      // Another request rotated this token first; undo ours.
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, next.sessionId));
      return null;
    }
    return next;
  });
}

export async function revokeSession(db: Database, refreshToken: string, now: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashRefreshToken(refreshToken)), isNull(sessions.revokedAt)));
}

async function revokeAllForUser(db: Database, userId: string, now: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
