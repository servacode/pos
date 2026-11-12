import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { EXPORT_ENTITIES, type ExportEntity, type ExportManifest } from '@serva/core';
import { withTenant, withTenantSnapshot, type Database, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import type { AccessClaims } from '../../auth/tokens';
import { AppError } from '../../errors';
import type { RequestMeta } from '../../types';
import { audit } from '../audit';
import { requireOwner } from '../catalog/common';
import { ZipWriter } from './zip';

/**
 * «تصدير كل بيانات المتجر» (docs/specs/24-legal.md: the owner owns the data, and may take all of it).
 *
 * A ZIP with, for each entity of EXPORT_ENTITIES, a JSON file (the rows exactly as stored, lossless)
 * and a CSV file for Excel (a byte-order mark so Arabic opens right, CRLF lines), plus manifest.json
 * and README.txt. Every column of every table is written, except a user's password and PIN hashes.
 *
 * It is read in one read-only repeatable-read transaction, so the archive is a consistent picture of
 * one instant, through a server-side cursor in pages of 1000 rows: a store of a million lines costs
 * a few megabytes of memory. The archive is written to a temporary file first and sent from there:
 * a slow download therefore never holds a database transaction open (the runtime role ends one
 * idle for 30 seconds). Only the owner may export, one export per store at a time.
 */

const BOM = String.fromCharCode(0xfeff);
const MAX_CONCURRENT = 3;

/** The table behind each entity, and the columns that never leave the server. */
const SOURCES: Record<ExportEntity, { table: string; omit?: string[] }> = {
  settings: { table: 'tenant_settings' },
  branches: { table: 'branches' },
  users: { table: 'users', omit: ['password_hash', 'pin_hash', 'pin_length', 'pin_version'] },
  units: { table: 'units' },
  tax_rates: { table: 'tax_rates' },
  exchange_rates: { table: 'exchange_rates' },
  categories: { table: 'categories' },
  products: { table: 'products' },
  variants: { table: 'variants' },
  prices: { table: 'prices' },
  barcodes: { table: 'barcodes' },
  stock_levels: { table: 'stock_levels' },
  stock_movements: { table: 'stock_movements' },
  customers: { table: 'customers' },
  suppliers: { table: 'suppliers' },
  invoices: { table: 'invoices' },
  invoice_lines: { table: 'invoice_lines' },
  invoice_payments: { table: 'invoice_payments' },
  sale_returns: { table: 'sale_returns' },
  sale_return_lines: { table: 'sale_return_lines' },
  receipts: { table: 'receipts' },
  purchases: { table: 'purchases' },
  purchase_lines: { table: 'purchase_lines' },
  supplier_payments: { table: 'supplier_payments' },
  supplier_returns: { table: 'supplier_returns' },
  stocktakes: { table: 'stocktakes' },
  transfers: { table: 'transfers' },
  shifts: { table: 'shifts' },
  cash_movements: { table: 'cash_movements' },
  expenses: { table: 'expenses' },
  accounts: { table: 'accounts' },
  journal_entries: { table: 'journal_entries' },
  journal_lines: { table: 'journal_lines' },
  promotions: { table: 'promotions' },
  vouchers: { table: 'vouchers' },
  serials: { table: 'serials' },
};

const TABLE_NAME = /^[a-z_]+$/;
const FORMULA_START = /^(?:[=@\t\r]|[+-](?![\d.]))/;

/** One CSV field: quoted, a spreadsheet formula defanged with an apostrophe, JSON for objects. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

interface TableInfo {
  columns: string[];
  key: string[];
}

/** The columns of a table in their order, and its primary key without the tenant, for a stable order. */
async function tableInfo(tx: Transaction, table: string, omit: string[]): Promise<TableInfo> {
  const columns = await tx.execute<{ column_name: string }>(sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} order by ordinal_position`);
  const key = await tx.execute<{ attname: string }>(sql`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary
    order by array_position(i.indkey::int2[], a.attnum)`);
  return {
    columns: columns.map((c) => c.column_name).filter((c) => !omit.includes(c)),
    key: key.map((k) => k.attname).filter((k) => k !== 'tenant_id'),
  };
}

let cursors = 0;

/** The rows of a table as JSON text, page by page through a cursor (rows come in primary-key order). */
async function* rowsOf(
  tx: Transaction,
  tenantId: string,
  table: string,
  info: TableInfo,
  omit: string[],
): AsyncGenerator<string[]> {
  if (!TABLE_NAME.test(table)) throw new Error(`unsafe table name ${table}`);
  const name = sql.identifier(`export_cursor_${String(++cursors)}`);
  const stripped = omit.reduce((acc: SQL, column) => sql`${acc} - ${column}::text`, sql`to_jsonb(t)`);
  const order =
    info.key.length > 0
      ? sql.join(
          info.key.map((k) => sql`t.${sql.identifier(k)}`),
          sql`, `,
        )
      : sql`1`;
  await tx.execute(
    sql`declare ${name} no scroll cursor for
      select (${stripped})::text as row from ${sql.identifier('public')}.${sql.identifier(table)} t
      where t.tenant_id = ${tenantId}::uuid order by ${order}`,
  );
  try {
    for (;;) {
      // FETCH takes a literal count, not a parameter: PAGE, written out
      const page = await tx.execute<{ row: string }>(sql`fetch forward 1000 from ${name}`);
      if (page.length === 0) return;
      yield page.map((r) => r.row);
    }
  } finally {
    await tx.execute(sql`close ${name}`);
  }
}

const running = new Set<string>();

export interface ExportFile {
  path: string;
  bytes: number;
  fileName: string;
  /** Deletes the temporary file; call once the response has ended */
  dispose: () => Promise<void>;
}

const README = `تصدير بيانات المتجر من سيرفا
==============================

هذا الأرشيف فيه كل بيانات متجرك كما هي في سيرفا لحظة التصدير. بياناتك ملكك.

- json/*.json   كل ملف فيه صفوف جدول واحد كما هي في قاعدة البيانات (الأدق، للنسخ الاحتياطي والنقل).
- csv/*.csv     الصفوف نفسها لتفتحها في Excel (ترميز UTF-8). الخلايا التي تبدأ بـ = أو @ تسبقها فاصلة عليا حمايةً من الصيغ.
- manifest.json تاريخ التصدير وعدد صفوف كل جدول.

المبالغ أعداد صحيحة بأصغر وحدة للعملة (ليرة سورية ودولار: جزء من مئة، 125000 تعني 1250.00)، والكميات بالألف (12500 تعني 12.5).
كلمات السر ورموز الدخول لا تُصدَّر أبداً.
`;

/** Builds the archive in a temporary file and returns it; the caller sends it and then disposes it. */
export async function exportStore(
  db: Database,
  auth: AccessClaims,
  meta: RequestMeta,
  now: Date,
): Promise<ExportFile> {
  const { tenantId } = auth;
  await withTenant(db, tenantId, (tx) => requireOwner(tx, auth.userId));
  if (running.has(tenantId) || running.size >= MAX_CONCURRENT) {
    throw new AppError(429, 'rate_limited', 'يجري تصدير الآن. انتظر انتهاءه ثم حاول مجدداً.');
  }
  running.add(tenantId);
  const path = join(tmpdir(), `serva-export-${createUuidV7()()}.zip`);
  const dispose = () => unlink(path).catch(() => undefined);
  try {
    const out = createWriteStream(path);
    const zip = new ZipWriter(out, now);
    const manifest: ExportManifest = {
      format: 'serva-export',
      version: 1,
      exportedAt: now.toISOString(),
      tenantId,
      amounts: 'minor-units',
      entities: [],
    };
    await zip.add('README.txt', [README]);
    await withTenantSnapshot(db, tenantId, async (tx) => {
      for (const entity of EXPORT_ENTITIES) {
        const { table, omit = [] } = SOURCES[entity];
        const info = await tableInfo(tx, table, omit);
        let count = 0;
        await zip.add(
          `json/${entity}.json`,
          (async function* () {
            yield '[';
            for await (const page of rowsOf(tx, tenantId, table, info, omit)) {
              yield `${count > 0 ? ',' : ''}\n${page.join(',\n')}`;
              count += page.length;
            }
            yield '\n]\n';
          })(),
        );
        await zip.add(
          `csv/${entity}.csv`,
          (async function* () {
            yield `${BOM}${info.columns.map((c) => csvCell(c)).join(',')}\r\n`;
            for await (const page of rowsOf(tx, tenantId, table, info, omit)) {
              const lines = page.map((json) => {
                const row = JSON.parse(json) as Record<string, unknown>;
                return info.columns.map((c) => csvCell(row[c])).join(',');
              });
              yield `${lines.join('\r\n')}\r\n`;
            }
          })(),
        );
        manifest.entities.push({ name: entity, rows: count });
      }
    });
    await zip.add('manifest.json', [`${JSON.stringify(manifest, null, 2)}\n`]);
    await zip.finish();
    const { size } = await stat(path);
    await withTenant(db, tenantId, (tx) =>
      audit(
        tx,
        {
          tenantId,
          userId: auth.userId,
          action: 'store.export',
          entity: 'tenant',
          entityId: tenantId,
          data: { bytes: size, rows: manifest.entities.reduce((n, e) => n + e.rows, 0) },
        },
        meta,
      ),
    );
    return {
      path,
      bytes: size,
      fileName: `serva-export-${now.toISOString().slice(0, 10)}.zip`,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    running.delete(tenantId);
  }
}
