import { eq, sql } from 'drizzle-orm';
import {
  customerInput,
  normalizeArabic,
  phoneSchema,
  supplierInput,
  type CurrencyCode,
  type CustomerInput,
  type ImportRow,
  type SupplierInput,
} from '@serva/core';
import { customers, suppliers } from '@serva/db';
import { ZodError } from 'zod';
import { AppError } from '../../errors';
import { createCustomerTx, updateCustomerTx } from '../customers';
import { baseCurrency, saveSupplierTx } from '../purchases';
import { amountOf, Issues, shortText, textOf, truthy } from './cells';
import { fieldOfPath, issuesOf, type ImportContext, type Results } from './context';
import { holds } from './holds';
import { postOpeningBalance } from './opening';

type Kind = 'customer' | 'supplier';

interface Parsed {
  line: number;
  name: string;
  /** Fields the file gave, ready for the schemas; absent ones are not sent (an update keeps them) */
  fields: Record<string, unknown>;
  balanceMinor: number | null;
}

function parseRow(kind: Kind, row: ImportRow, base: CurrencyCode, issues: Issues): Parsed {
  const label = kind === 'customer' ? 'اسم الزبون' : 'اسم المورد';
  const name = shortText(row, 'name', 120, label, issues);
  if (name === null && !issues.any) issues.add('name', `${label} مطلوب`);
  const fields: Record<string, unknown> = { name: name ?? '' };
  const phone = textOf(row.values.phone);
  if (phone !== null) {
    // The screens’ union schema answers a bare «Invalid input»; the phone schema says what is wrong
    const checked = phoneSchema.safeParse(phone);
    if (checked.success) fields.phone = checked.data;
    else issues.add('phone', checked.error.issues[0]?.message ?? 'رقم الجوال غير صحيح');
  }
  const notes = shortText(row, 'notes', 500, 'الملاحظات', issues);
  if (notes !== null) fields.notes = notes;
  if (kind === 'customer') {
    const taxNumber = shortText(row, 'taxNumber', 40, 'الرقم الضريبي', issues);
    if (taxNumber !== null) fields.taxNumber = taxNumber;
    const address = shortText(row, 'address', 200, 'العنوان', issues);
    if (address !== null) fields.address = address;
    const limit = amountOf(row, 'creditLimit', base, 'حد الدين', issues);
    if (limit !== null) fields.creditLimitMinor = limit;
    const tier = textOf(row.values.priceTier);
    if (tier !== null) {
      const key = normalizeArabic(tier);
      if (truthy(tier)) fields.priceTier = 'wholesale';
      else if (['مفرق', 'retail', 'لا', 'no', '0', 'مفرد'].includes(key)) fields.priceTier = 'retail';
      else issues.add('priceTier', 'نوع السعر: اكتب «جملة» أو «مفرق»');
    }
  }
  const balanceMinor = amountOf(row, 'balance', base, 'الرصيد', issues, { signed: true });
  return { line: row.line, name: name ?? '', fields, balanceMinor };
}

/** The first problem of a failed write, as the row's answer. */
function problemOf(error: unknown): { field: string; message: string } {
  if (error instanceof ZodError) {
    const issue = error.issues[0]!;
    return { field: fieldOfPath(issue.path.map(String).join('.')), message: issue.message };
  }
  const [first] = issuesOf(error);
  return { field: fieldOfPath(first!.path), message: first!.message };
}

interface ExistingParty {
  id: string;
  name: string;
  phone: string | null;
  taxNumber?: string | null;
  address?: string | null;
  notes: string | null;
  creditLimitMinor?: number | null;
  priceTier?: string;
}

export async function importParties(
  kind: Kind,
  ctx: ImportContext,
  rows: ImportRow[],
  results: Results,
): Promise<void> {
  const { tx, input } = ctx;
  const canPostBalance = await holds(tx, ctx.auth.userId, 'accounting.post');
  const base = await baseCurrency(tx);
  const schema = kind === 'customer' ? customerInput : supplierInput;

  for (const row of rows) {
    const issues = new Issues();
    const parsed = parseRow(kind, row, base, issues);
    if (parsed.balanceMinor !== null && parsed.balanceMinor !== 0 && !canPostBalance) {
      issues.add('balance', 'الرصيد الافتتاحي يقيّده المالك فقط');
    }
    // The schemas of the normal screens say what a name or a phone may be
    const checked = schema.safeParse(parsed.fields);
    if (!checked.success) {
      for (const issue of checked.error.issues)
        issues.add(fieldOfPath(issue.path.map(String).join('.')), issue.message);
    }
    if (issues.any || !checked.success) {
      results.fail(row.line, issues.list);
      continue;
    }
    const data = checked.data as Record<string, unknown> & { name: string; phone?: string | null };
    try {
      await tx.transaction(async (sp) => {
        const scoped = { ...ctx, tx: sp };
        const existing = await findExisting(kind, scoped, data.name, data.phone ?? null);
        const balance = parsed.balanceMinor ?? 0;
        let partyId: string;
        let fresh = false;
        if (!existing) {
          if (kind === 'customer') {
            partyId = (await createCustomerTx(sp, ctx.auth, data as CustomerInput, ctx.meta, ctx.now)).id;
          } else {
            partyId = (await saveSupplierTx(sp, ctx.auth, null, data as SupplierInput, ctx.meta, ctx.now)).id;
          }
          fresh = true;
          results.set(row.line, 'create');
        } else if (input.existing === 'skip') {
          results.set(row.line, 'skip', ['موجود في المتجر، تُرك كما هو']);
          return;
        } else {
          partyId = existing.id;
          if (changes(existing, data)) {
            if (kind === 'customer')
              await updateCustomerTx(sp, ctx.auth, partyId, data as CustomerInput, ctx.meta, ctx.now);
            else await saveSupplierTx(sp, ctx.auth, partyId, data as SupplierInput, ctx.meta, ctx.now);
            results.set(row.line, 'update');
          } else results.set(row.line, 'skip', ['لا تغيير']);
        }
        if (balance !== 0) {
          if (!fresh && (await hasLedgerLines(scoped, kind, partyId))) {
            results.note(row.line, 'لم يُقيَّد الرصيد الافتتاحي: لهذا الحساب قيود سابقة');
          } else {
            await postOpeningBalance(sp, ctx.auth, ctx.meta, {
              party: kind,
              partyId,
              name: data.name,
              balanceMinor: balance,
              date: input.date,
            });
            if (results.statusOf(row.line) === 'skip')
              results.set(row.line, 'update', ['يُقيَّد الرصيد الافتتاحي فقط']);
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode >= 500) throw error;
      const { field, message } = problemOf(error);
      results.fail(row.line, [{ field, message }]);
    }
  }
}

/** The customer or supplier the row means: the same phone, or with no phone the same name. */
async function findExisting(
  kind: Kind,
  ctx: ImportContext,
  name: string,
  phone: string | null,
): Promise<ExistingParty | null> {
  const { tx } = ctx;
  if (kind === 'customer') {
    const where = phone ? eq(customers.phone, phone) : sql`lower(${customers.name}) = lower(${name})`;
    const [row] = await tx.select().from(customers).where(where).orderBy(customers.createdAt).limit(1);
    return row ?? null;
  }
  const where = phone ? eq(suppliers.phone, phone) : sql`lower(${suppliers.name}) = lower(${name})`;
  const [row] = await tx.select().from(suppliers).where(where).orderBy(suppliers.createdAt).limit(1);
  return row ?? null;
}

/** Whether what the file says differs from what is stored (only the fields the file gave). */
function changes(existing: ExistingParty, data: Record<string, unknown>): boolean {
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  const pairs: [string, unknown][] = [
    ['name', existing.name],
    ['phone', existing.phone],
    ['notes', existing.notes],
    ['taxNumber', existing.taxNumber],
    ['address', existing.address],
    ['creditLimitMinor', existing.creditLimitMinor],
    ['priceTier', existing.priceTier],
  ];
  return pairs.some(([key, stored]) => key in data && data[key] !== undefined && !same(data[key], stored));
}

/** Whether any ledger line already names this customer or supplier. */
async function hasLedgerLines(ctx: ImportContext, kind: Kind, partyId: string): Promise<boolean> {
  const rows = await ctx.tx.execute<{ found: boolean }>(sql`
    select exists (select 1 from journal_lines where party_type = ${kind} and party_id = ${partyId}) as found`);
  return rows[0]?.found === true;
}
