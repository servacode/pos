import { afterAll, describe, expect, it } from 'vitest';
import { closeOwnerDb, ownerDb, resetDatabase } from './helpers';

afterAll(closeOwnerDb);

describe('test database reset', () => {
  it('empties every table found in the catalog, including ones it was never told about', async () => {
    const sql = ownerDb();
    await sql`create table if not exists zz_reset_probe (id int)`;
    try {
      await sql`insert into zz_reset_probe values (1)`;
      await resetDatabase();
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from zz_reset_probe`;
      expect(row?.n).toBe(0);
    } finally {
      await sql`drop table zz_reset_probe`;
    }
  });

  it('keeps reference data seeded by migrations', async () => {
    await resetDatabase();
    const [row] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from plans where is_default`;
    expect(row?.n).toBe(1);
  });
});
