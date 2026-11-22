import { inArray } from 'drizzle-orm';
import { serials, type Transaction } from '@serva/db';
import { invalid, normalized, outgoingSerials, tracking } from './serials-core';

/**
 * Round 60: a count or waste of a product that tracks serial numbers says WHICH numbers left (or came in), so the
 * serial list and the stock agree. A shortage names one in-stock number per missing piece (they become «lost»);
 * a surplus may name the new numbers (they come in stock). Nothing is posted here: the count's own entry stands.
 * A shortage with no numbers is refused, unless `lenient` (a phone's offline count, a till's waste: those are
 * never refused, and the owner puts the list right from the serial page).
 */
export async function countSerials(
  tx: Transaction,
  tenantId: string,
  branchId: string,
  lines: readonly {
    variantId: string;
    diffQty: number;
    serials?: readonly string[] | undefined;
    /** The line is a write-off (damaged, expired, waste) rather than a count */
    waste?: boolean;
  }[],
  lenient: boolean,
  /** The store asks for the numbers on every write-off (till.serialsOnWaste): a shortage with none is refused */
  requireOnWaste = false,
): Promise<void> {
  const tracked = await tracking(
    tx,
    lines.map((l) => l.variantId),
  );
  const leaving: { variantId: string; qty: number; serials: string[] }[] = [];
  const arriving: { variantId: string; serial: string }[] = [];
  for (const [i, line] of lines.entries()) {
    const field = `lines.${i}.serials`;
    const given = [...new Set((line.serials ?? []).map(normalized))];
    if (!tracked.get(line.variantId)?.tracks) {
      if (given.length > 0) throw invalid({ [field]: 'هذا الصنف لا يُباع بأرقام تسلسلية' });
      continue;
    }
    if (line.diffQty < 0) {
      const pieces = Math.ceil(-line.diffQty / 1000);
      if (given.length === 0) {
        if (requireOnWaste && line.waste) {
          throw invalid({
            [field]: `إعداد المحل «اطلب الرقم التسلسلي عند الإتلاف» مفعّل: اختر ${pieces} رقماً تسلسلياً للقطع المُتلَفة`,
          });
        }
        if (lenient) continue;
        throw invalid({
          [field]: `هذا الصنف له أرقام تسلسلية: اختر ${pieces} رقماً للقطع الناقصة`,
        });
      }
      if (given.length !== pieces) {
        throw invalid({ [field]: `اختر ${pieces} رقماً تسلسلياً للقطع الناقصة (اخترت ${given.length})` });
      }
      leaving.push({ variantId: line.variantId, qty: pieces * 1000, serials: given });
    } else if (line.diffQty > 0) {
      const extra = Math.ceil(line.diffQty / 1000);
      // Round 62: a surplus of a tracked product adds stock, so it needs its numbers too (the lenient paths stay as they were)
      if (given.length === 0 && !lenient) {
        throw invalid({ [field]: `هذا الصنف له أرقام تسلسلية: اكتب ${extra} رقماً للقطع الزائدة` });
      }
      if (given.length === 0) continue;
      if (given.length !== extra) {
        throw invalid({ [field]: `اكتب ${extra} رقماً للقطع الزائدة (كُتب ${given.length})` });
      }
      for (const serial of given) arriving.push({ variantId: line.variantId, serial });
    }
  }
  if (leaving.length > 0) {
    const ids = await outgoingSerials(tx, branchId, leaving);
    await tx
      .update(serials)
      .set({ status: 'lost' })
      .where(inArray(serials.id, [...ids]));
  }
  if (arriving.length > 0) {
    const known = await tx
      .select({
        id: serials.id,
        serial: serials.serial,
        status: serials.status,
        variantId: serials.variantId,
      })
      .from(serials)
      .where(
        inArray(
          serials.serial,
          arriving.map((a) => a.serial),
        ),
      );
    // A number marked «ضائع» that is found again comes back by the count; any other known number is refused
    const wanted = new Map(arriving.map((a) => [a.serial, a.variantId]));
    const found: string[] = [];
    for (const k of known) {
      if (k.status === 'lost' && k.variantId === wanted.get(k.serial)) found.push(k.id);
      else throw invalid({ lines: `الرقم ${k.serial} موجود في المحل من قبل` });
    }
    if (found.length > 0)
      await tx
        .update(serials)
        .set({ status: 'in_stock', branchId, saleId: null, soldOn: null, warrantyUntil: null })
        .where(inArray(serials.id, found));
    const back = new Set(known.map((k) => k.serial));
    const fresh = arriving.filter((a) => !back.has(a.serial));
    if (fresh.length > 0)
      await tx.insert(serials).values(
        fresh.map((a) => ({
          tenantId,
          variantId: a.variantId,
          serial: a.serial,
          status: 'in_stock',
          branchId,
        })),
      );
  }
}
