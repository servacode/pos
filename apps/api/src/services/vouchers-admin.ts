import { sql } from 'drizzle-orm';
import type { CurrencyCode, VoucherList, VoucherUpdateInput } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { postEntry } from './posting';
import { baseCurrency } from './purchases';

const newId = createUuidV7();

/** The day the store is on (its timezone), to tell an expired voucher from a live one */
const today = sql`(now() at time zone (select t.timezone from tenants t join tenant_settings s on s.tenant_id = t.id limit 1))::date`;

/**
 * The vouchers the store has issued and what is left on each. The till issues and spends them; the
 * owner sets an expiry day or voids one here. «Open» means something is left, it is not voided and it
 * has not expired.
 */
export function listVouchers(
  db: Database,
  auth: AccessClaims,
  query: { status?: 'open' | 'all'; limit?: number; cursor?: string; kind?: string; q?: string },
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
    const live = sql`amount_minor > redeemed_minor and voided_at is null and (expires_on is null or expires_on >= ${today})`;
    const open = (query.status ?? 'open') === 'open';
    const like = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
    const rows = await tx.execute<{
      code: string;
      kind: string;
      currency: string;
      amount: string;
      redeemed: string;
      created_at: string;
      expires_on: string | null;
      voided_at: string | null;
      expired: boolean;
    }>(sql`
      select code, kind, currency, amount_minor::text as amount, redeemed_minor::text as redeemed,
             created_at::text, expires_on::text, voided_at::text,
             (expires_on is not null and expires_on < ${today}) as expired
      from vouchers
      where ${open ? live : sql`true`}
        and ${query.kind ? sql`kind = ${query.kind}` : sql`true`}
        and ${like ? sql`code ilike ${like}` : sql`true`}
      order by created_at desc, code desc
      limit ${limit + 1} offset ${offset}`);
    const totals = await tx.execute<{ currency: string; amount: string; n: string }>(sql`
      select currency, sum(amount_minor - redeemed_minor)::text as amount, count(*)::text as n
      from vouchers where ${live} group by currency order by currency`);
    return {
      items: rows.slice(0, limit).map((r) => {
        const amount = Number(r.amount);
        const redeemed = Number(r.redeemed);
        const voided = r.voided_at !== null;
        const state: 'void' | 'expired' | 'open' | 'used' = voided
          ? 'void'
          : r.expired
            ? 'expired'
            : amount > redeemed
              ? 'open'
              : 'used';
        return {
          code: r.code,
          kind: r.kind,
          currency: r.currency as CurrencyCode,
          amountMinor: amount,
          redeemedMinor: redeemed,
          remainingMinor: voided || r.expired ? 0 : Math.max(0, amount - redeemed),
          createdAt: new Date(r.created_at).toISOString(),
          expiresOn: r.expires_on,
          voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
          state,
        };
      }),
      nextCursor: rows.length > limit ? Buffer.from(`o:${offset + limit}`).toString('base64url') : null,
      outstanding: totals.map((t) => ({
        currency: t.currency as CurrencyCode,
        amountMinor: Number(t.amount),
        count: Number(t.n),
      })),
    };
  });
}

/**
 * Sets a voucher's last day, or voids it. Voiding a base-currency voucher moves what was left from
 * 2310 (what the store owes on vouchers) to 4920 (other income), so the books stop owing it; a voucher
 * in another currency is refused here and goes through a manual entry. A spent voucher cannot be voided.
 */
export async function updateVoucher(
  db: Database,
  auth: AccessClaims,
  code: string,
  input: VoucherUpdateInput,
  meta: RequestMeta,
  now: Date,
): Promise<{ code: string; expiresOn: string | null; voidedAt: string | null }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [v] = await tx.execute<{
      id: string;
      currency: string;
      amount: string;
      redeemed: string;
      expires_on: string | null;
      voided_at: string | null;
    }>(sql`
      select id, currency, amount_minor::text as amount, redeemed_minor::text as redeemed,
             expires_on::text, voided_at::text
      from vouchers where code = ${code} for update`);
    if (!v) throw new AppError(404, 'not_found', 'هذه القسيمة غير موجودة.');
    if (v.voided_at) throw new AppError(409, 'conflict', 'هذه القسيمة ملغاة من قبل.');
    const left = Number(v.amount) - Number(v.redeemed);
    if (input.void) {
      if (left <= 0) throw new AppError(409, 'conflict', 'هذه القسيمة مصروفة بالكامل.');
      const base = await baseCurrency(tx);
      if (v.currency !== base) {
        throw new AppError(409, 'conflict', 'قسيمة بعملة غير الأساسية. أنهِها بقيد يدوي.');
      }
      const [day] = await tx.execute<{ today: string }>(sql`select ${today}::text as today`);
      await postEntry(tx, {
        tenantId: auth.tenantId,
        branchId: null,
        date: day?.today ?? now.toISOString().slice(0, 10),
        sourceType: 'manual',
        sourceId: newId(),
        sourceNumber: null,
        memo: `إلغاء القسيمة ${code}${input.reason ? ` — ${input.reason}` : ''}`,
        baseCurrency: base,
        lines: [
          { account: { code: '2310' }, baseMinor: left, currency: base, amountMinor: left, rate: null },
          { account: { code: '4920' }, baseMinor: -left, currency: base, amountMinor: -left, rate: null },
        ],
        kind: 'manual',
        createdBy: auth.userId,
      });
      await tx.execute(sql`
        update vouchers set voided_at = ${now.toISOString()}::timestamptz, void_reason = ${input.reason ?? null}
        where id = ${v.id}`);
    } else if (input.expiresOn !== undefined) {
      await tx.execute(sql`
        update vouchers set expires_on = ${input.expiresOn}::date
        where id = ${v.id}`);
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: input.void ? 'voucher.void' : 'voucher.expiry',
        entity: 'voucher',
        entityId: v.id,
        changes: input.void
          ? { voided: [false, true] }
          : { expiresOn: [v.expires_on, input.expiresOn ?? null] },
        data: { code, ...(input.reason ? { reason: input.reason } : {}) },
      },
      meta,
    );
    const [after] = await tx.execute<{ expires_on: string | null; voided_at: string | null }>(
      sql`select expires_on::text, voided_at::text from vouchers where id = ${v.id}`,
    );
    return { code, expiresOn: after?.expires_on ?? null, voidedAt: after?.voided_at ?? null };
  });
}
