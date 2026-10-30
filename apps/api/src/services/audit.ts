import { auditLogs, type Transaction } from '@serva/db';
import type { RequestMeta } from '../types';

export type AuditActor = 'user' | 'accountant' | 'platform_support' | 'device' | 'system';

export async function audit(
  tx: Transaction,
  entry: {
    tenantId: string;
    userId?: string | null;
    actorType?: AuditActor;
    /** Support grant or accountant link the action was made under */
    grantId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    /** Field-by-field changes: { field: [before, after] } */
    changes?: Record<string, [unknown, unknown]>;
    data?: unknown;
    reason?: string;
  },
  meta: RequestMeta,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: entry.tenantId,
    userId: entry.userId ?? null,
    actorType: entry.actorType ?? 'user',
    grantId: entry.grantId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    changes: entry.changes ?? null,
    data: entry.data ?? null,
    reason: entry.reason ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}
