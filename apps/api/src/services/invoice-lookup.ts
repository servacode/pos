import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '@serva/db';
import type { InvoiceLookup } from '@serva/core';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';

/**
 * «مرتجع» from any till of the store: finds a sale by the number printed on its receipt (or the
 * receipt's barcode, which is the same text), with what returns already took back from it. A till
 * only holds its own documents, so this is how an invoice sold on another till or branch is found.
 * Any signed-in till of the store may look; the return itself still goes through the usual rules.
 */
export function lookupInvoice(db: Database, device: DeviceClaims, query: string): Promise<InvoiceLookup> {
  const notFound = () => new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
  return withTenant(db, device.tenantId, async (tx) => {
    const typed = query.trim();
    const digits = typed.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
    const exact = await tx.execute<{ id: string; number: string; device_time: string; payload: unknown }>(sql`
      select id, number, device_time, payload from invoices
      where upper(number) = upper(${typed}) limit 1`);
    let row = exact[0];
    if (!row && digits.length >= 3 && digits === typed.replace(/\s/g, '')) {
      // The last digits of the number: «154» finds …-0000154 when only one invoice ends so
      const hits = await tx.execute<{
        id: string;
        number: string;
        device_time: string;
        payload: unknown;
      }>(sql`
        select id, number, device_time, payload from invoices
        where regexp_replace(number, '\D', '', 'g') like ${`%${digits}`}
        order by device_time desc limit 2`);
      if (hits.length === 1) row = hits[0];
    }
    if (!row) throw notFound();
    const returned = await tx.execute<{
      sale_line_no: number;
      qty: string;
      gross: string;
      discount: string;
      tax: string;
      total: string;
    }>(sql`
      select rl.sale_line_no, sum(rl.qty)::text as qty, sum(rl.gross_ex_tax_minor)::text as gross,
             sum(rl.discount_ex_tax_minor)::text as discount, sum(rl.tax_minor)::text as tax,
             sum(rl.total_minor)::text as total
      from sale_return_lines rl
      join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
      where r.sale_id = ${row.id}
      group by rl.sale_line_no`);
    return {
      id: row.id,
      number: row.number,
      deviceTime: new Date(row.device_time).toISOString(),
      payload: row.payload,
      returned: returned.map((l) => ({
        saleLineNo: Number(l.sale_line_no),
        qty: Number(l.qty),
        grossExTaxMinor: Number(l.gross),
        discountExTaxMinor: Number(l.discount),
        taxMinor: Number(l.tax),
        totalMinor: Number(l.total),
      })),
    };
  });
}
