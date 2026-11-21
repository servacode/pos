import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore } from './staff';
import { cartLine, documents, openStore, push, sale, shiftOpen } from './accounting-fixtures';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const search = (token: string, q: string) =>
  app.inject({ method: 'GET', url: `/v1/me/search?q=${encodeURIComponent(q)}`, headers: bearer(token) });

describe('GET /v1/me/search', () => {
  it('finds customers and suppliers by name or phone, in the search form (hamza, ة/ه, Arabic-Indic digits)', async () => {
    const owner = await testStore(app);
    const db = ownerDb();
    await db`insert into customers (tenant_id, name, phone) values (${owner.tenantId}, 'أحمد الخطيب', '0944123456')`;
    await db`insert into customers (tenant_id, name) values (${owner.tenantId}, 'رنا')`;
    await db`insert into suppliers (tenant_id, name, phone) values (${owner.tenantId}, 'مؤسسة الوردة', '0955000111')`;

    const byName = (await search(owner.accessToken, 'احمد')).json().items;
    expect(byName.map((h: { label: string }) => h.label)).toEqual(['أحمد الخطيب']);
    expect(byName[0]).toMatchObject({ group: 'الزبائن', detail: '0944123456' });

    const byPhone = (await search(owner.accessToken, '٠٩٤٤١٢٣')).json().items;
    expect(byPhone.map((h: { label: string }) => h.label)).toEqual(['أحمد الخطيب']);

    const supplier = (await search(owner.accessToken, 'الورده')).json().items;
    expect(supplier).toHaveLength(1);
    expect(supplier[0]).toMatchObject({ group: 'الموردون', label: 'مؤسسة الوردة' });
  });

  it('asks for two letters, caps each kind at four, and treats % and _ as plain text', async () => {
    const owner = await testStore(app);
    const db = ownerDb();
    for (let i = 0; i < 6; i += 1) {
      await db`insert into customers (tenant_id, name) values (${owner.tenantId}, ${`زبون ${String(i)}`})`;
    }
    await db`insert into customers (tenant_id, name) values (${owner.tenantId}, 'خصم 50% سنوي')`;
    expect((await search(owner.accessToken, 'ز')).json().items).toEqual([]);
    expect((await search(owner.accessToken, 'زبون')).json().items).toHaveLength(4);
    const percent = (await search(owner.accessToken, '50%')).json().items;
    expect(percent.map((h: { label: string }) => h.label)).toEqual(['خصم 50% سنوي']);
    expect((await search(owner.accessToken, '%%')).json().items).toEqual([]);
  });

  it('gives each kind only to who holds its permission, and nothing to a person with none', async () => {
    const owner = await testStore(app);
    const db = ownerDb();
    await db`insert into customers (tenant_id, name) values (${owner.tenantId}, 'سامر')`;
    await db`insert into suppliers (tenant_id, name) values (${owner.tenantId}, 'سامي للتجارة')`;
    await db`insert into roles (tenant_id, key, name, permissions) values (${owner.tenantId}, 'nobody', 'بلا', '{}')`;
    const nobody = await staffUser(app, owner, 'nobody', '0922222222');
    expect((await search(nobody.accessToken, 'سام')).json().items).toEqual([]);
    const all = (await search(owner.accessToken, 'سام')).json().items.map((h: { group: string }) => h.group);
    expect(all.sort()).toEqual(['الزبائن', 'الموردون']);
  });

  it('finds a cheque by its number, its reference or the customer, on the server', async () => {
    const store = await openStore(app);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: bearer(store.accessToken),
      payload: { name: 'مؤسسة الفرات' },
    });
    const customer = made.json<{ id: string; name: string }>();
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const paid = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 50_000)],
        payments: [
          {
            method: 'cheque',
            currency: 'SYP',
            amountMinor: 50_000,
            reference: 'بنك سورية · 000123 · 2026-12-01',
            cheque: { bank: 'بنك سورية', number: '000123', dueDate: '2026-12-01', drawer: 'أحمد' },
          },
        ],
        customerId: customer.id,
        customerName: customer.name,
      }),
    );
    const res = await push(app, store.device, [open, paid]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const byRef = (await search(store.accessToken, '000123')).json().items;
    const cheques = byRef.filter((h: { group: string }) => h.group === 'الشيكات');
    expect(cheques).toHaveLength(1);
    expect(cheques[0]).toMatchObject({
      label: 'بنك سورية · 000123 · 2026-12-01',
      detail: 'مؤسسة الفرات',
      to: '/cheques',
    });
    const byName = (await search(store.accessToken, 'الفرات'))
      .json()
      .items.map((h: { group: string }) => h.group);
    expect(byName).toContain('الشيكات');
    expect(byName).toContain('الزبائن');
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me/search?q=سامر' })).statusCode).toBe(401);
  });
});
