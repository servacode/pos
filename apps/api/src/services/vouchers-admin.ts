import { sql } from 'drizzle-orm';
import type { CurrencyCode, VoucherList } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/** The vouchers the store has issued and what is left on each (read only; the till issues and spends them). */
export function listVouchers(
  db: Database,
  auth: AccessClaims,
  query: { status?: 'open' | 'all'; limit?: number; cursor?: string },
): Promise<VoucherList> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const limit = query.limit ?? 50;
    let offset = 0;
    if (query.cursor) {
      const m = /^o:(\d{1,7})$/.exec(Buffer.from(query.cursor, 'base64url').toString());
      if (!m) {
        throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          cursor: 'صفحة غير صالحة. ارجع إلى أول القائمة',
        });
      }
      offset = Number(m[1]);
    }
    const open = (query.status ?? 'open') === 'open';
    const rows = await tx.execute<{
      code: string;
      kind: string;
      currency: string;
      amount: string;
      redeemed: string;
      created_at: string;
    }>(sql`
      select code, kind, currency, amount_minor::text as amount, redeemed_minor::text as redeemed,
             created_at::text
      from vouchers
      where ${open ? sql`amount_minor > redeemed_minor` : sql`true`}
      order by created_at desc, code desc
      limit ${limit + 1} offset ${offset}`);
    const totals = await tx.execute<{ currency: string; amount: string; n: string }>(sql`
      select currency, sum(amount_minor - redeemed_minor)::text as amount, count(*)::text as n
      from vouchers where amount_minor > redeemed_minor group by currency order by currency`);
    return {
      items: rows.slice(0, limit).map((r) => ({
        code: r.code,
        kind: r.kind,
        currency: r.currency as CurrencyCode,
        amountMinor: Number(r.amount),
        redeemedMinor: Number(r.redeemed),
        remainingMinor: Math.max(0, Number(r.amount) - Number(r.redeemed)),
        createdAt: new Date(r.created_at).toISOString(),
      })),
      nextCursor: rows.length > limit ? Buffer.from(`o:${offset + limit}`).toString('base64url') : null,
      outstanding: totals.map((t) => ({
        currency: t.currency as CurrencyCode,
        amountMinor: Number(t.amount),
        count: Number(t.n),
      })),
    };
  });
}
