import { auditLogs, type Transaction } from '@serva/db';
import type { RequestMeta } from '../types';

export async function audit(
  tx: Transaction,
  entry: {
    tenantId: string;
    userId?: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    data?: unknown;
  },
  meta: RequestMeta,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: entry.tenantId,
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}
