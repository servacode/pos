import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  plusDays,
  rentalCharge,
  type ContractPrice,
  type ContractPriceForTill,
  type CustomerListResponse,
  type DebtAgeingReport,
  type MaintenanceContract,
  type ProductDetail,
  type RentableUnit,
  type Rental,
  type SupplierRow,
} from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Rentals, maintenance contracts, contract prices, customer kinds and debt ageing (03 › الأدوات
 * الطبية). None of them posts: the money goes through the till as service lines.
 */

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

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const dev = (store: Store) => ({ authorization: store.device.authorization });
const post = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: as(store), payload });
const postDevice = (store: Store, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: dev(store), payload });

async function today(store: Store): Promise<string> {
  const [row] = await ownerDb()<{ day: string }[]>`
    select (now() at time zone timezone)::date::text as day from tenants where id = ${store.tenantId}`;
  return row!.day;
}

/** A store with a rentable wheelchair received with two serials, and a plain product with one */
async function storeWithWheelchairs() {
  const store = await openStore(app);
  const make = async (nameAr: string, extra: Record<string, unknown>) =>
    (
      await post(store, '/v1/products', {
        nameAr,
        tracksSerial: true,
        variants: [{ price: { currency: 'SYP', priceMinor: 2_000_000 } }],
        ...extra,
      })
    ).json<ProductDetail>();
  const chair = await make('كرسي متحرك', { rentable: true });
  const monitor = await make('جهاز ضغط', {});
  expect(chair.rentable).toBe(true);
  expect(monitor.rentable).toBe(false);
  const supplier = (await post(store, '/v1/suppliers', { name: 'وكيل' })).json<SupplierRow>();
  const bought = await post(store, '/v1/purchases', {
    supplierId: supplier.id,
    date: '2026-10-29',
    payment: 'cash',
    lines: [
      { variantId: chair.variants[0]!.id, qty: 2000, costMinor: 1_000_000, serials: ['WC001', 'WC002'] },
      { variantId: monitor.variants[0]!.id, qty: 1000, costMinor: 500_000, serials: ['BP001'] },
    ],
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, chair, monitor };
}

const RENT = {
  customerName: 'مشفى الأمل',
  phone: '0944555666',
  rateUnit: 'day',
  rateMinor: 5_000,
};

const serialStatus = async (serial: string) =>
  (await ownerDb()<{ status: string }[]>`select status from serials where serial = ${serial}`)[0]!.status;

describe('a rental', () => {
  it('lists the rentable pieces in the store, and only those', async () => {
    const { store } = await storeWithWheelchairs();
    const res = await app.inject({ method: 'GET', url: '/v1/device/rentals/units', headers: dev(store) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ items: RentableUnit[] }>().items.map((u) => [u.serial, u.item])).toEqual([
      ['WC001', 'كرسي متحرك'],
      ['WC002', 'كرسي متحرك'],
    ]);
    const typed = await app.inject({
      method: 'GET',
      url: '/v1/device/rentals/units?q=wc%20002',
      headers: dev(store),
    });
    expect(typed.json<{ items: RentableUnit[] }>().items.map((u) => u.serial)).toEqual(['WC002']);
  });

  it('puts the serial out, refuses it twice, and gives the service the till sells it with', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    const made = await postDevice(store, '/v1/device/rentals', {
      ...RENT,
      serial: 'wc001',
      expectedReturn: plusDays(day, 7),
      depositMinor: 20_000,
      depositVoucher: 'GV-000001',
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<Rental>()).toMatchObject({
      number: 'RNT-000001',
      status: 'out',
      overdue: false,
      serial: 'WC001',
      item: 'كرسي متحرك',
      startDate: day,
      depositMinor: 20_000,
      depositVoucher: 'GV-000001',
      currency: 'SYP',
    });
    expect(await serialStatus('WC001')).toBe('rented');

    const again = await postDevice(store, '/v1/device/rentals', {
      ...RENT,
      serial: 'WC001',
      expectedReturn: plusDays(day, 7),
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: { fields: { serial: 'هذه القطعة مؤجَّرة الآن.' } } });

    const units = await app.inject({ method: 'GET', url: '/v1/device/rentals/units', headers: dev(store) });
    expect(units.json<{ items: RentableUnit[] }>().items.map((u) => u.serial)).toEqual(['WC002']);

    const [service] = await ownerDb()<{ name_ar: string; type: string }[]>`
      select name_ar, type from products where name_ar = 'إيجار'`;
    expect(service).toMatchObject({ type: 'service' });
  });

  it('refuses a piece that is not rentable, unknown, or a return before the start', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    const refuse = async (payload: Record<string, unknown>, field: string) => {
      const res = await postDevice(store, '/v1/device/rentals', {
        ...RENT,
        expectedReturn: plusDays(day, 3),
        ...payload,
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(Object.keys(res.json<{ error: { fields: object } }>().error.fields)).toContain(field);
    };
    await refuse({ serial: 'BP001' }, 'serial');
    await refuse({ serial: 'NOPE1' }, 'serial');
    await refuse({ serial: 'WC001', startDate: plusDays(day, 5) }, 'expectedReturn');
    await refuse({ serial: 'WC001', depositMinor: 100 }, 'depositVoucher');
    await refuse({ serial: 'WC001', customerId: '0192e0a0-0000-7000-8000-000000000001' }, 'customerId');
    expect(await serialStatus('WC001')).toBe('in_stock');
  });

  it('is overdue once past its day, and on the admin list too', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    await postDevice(store, '/v1/device/rentals', {
      ...RENT,
      serial: 'WC001',
      startDate: plusDays(day, -10),
      expectedReturn: plusDays(day, -3),
    });
    await postDevice(store, '/v1/device/rentals', {
      ...RENT,
      serial: 'WC002',
      expectedReturn: plusDays(day, 4),
    });
    const mine = await app.inject({ method: 'GET', url: '/v1/rentals', headers: as(store) });
    const items = mine.json<{ items: Rental[] }>().items;
    // The soonest due first, and what it would cost if returned today
    expect(items.map((r) => [r.serial, r.overdue])).toEqual([
      ['WC001', true],
      ['WC002', false],
    ]);
    expect(items[0]!.chargeMinor).toBe(rentalCharge(plusDays(day, -10), day, 'day', 5_000));
    const device = await app.inject({ method: 'GET', url: '/v1/device/rentals', headers: dev(store) });
    expect(device.json<{ items: Rental[] }>().items).toHaveLength(2);
  });

  it('closes on return with its charge, frees the serial and refuses a second return', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    const made = (
      await postDevice(store, '/v1/device/rentals', {
        ...RENT,
        serial: 'WC001',
        rateUnit: 'week',
        rateMinor: 30_000,
        startDate: plusDays(day, -9),
        expectedReturn: plusDays(day, 1),
      })
    ).json<Rental>();
    const stale = await postDevice(store, `/v1/device/rentals/${made.id}/return`, {
      version: made.version + 3,
    });
    expect(stale.statusCode).toBe(409);
    const back = await postDevice(store, `/v1/device/rentals/${made.id}/return`, { version: made.version });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json<Rental>()).toMatchObject({
      status: 'returned',
      returnedOn: day,
      overdue: false,
      // 9 days is two started weeks
      chargeMinor: 60_000,
    });
    expect(await serialStatus('WC001')).toBe('in_stock');
    const second = await postDevice(store, `/v1/device/rentals/${made.id}/return`, {
      version: back.json<Rental>().version,
    });
    expect(second.statusCode).toBe(400);
    const open = await app.inject({ method: 'GET', url: '/v1/device/rentals', headers: dev(store) });
    expect(open.json<{ items: Rental[] }>().items).toEqual([]);
    const all = await app.inject({
      method: 'GET',
      url: '/v1/device/rentals?status=all',
      headers: dev(store),
    });
    expect(all.json<{ items: Rental[] }>().items).toHaveLength(1);
  });

  it('is flagged, not silently sold, when a till sells a piece that is out', async () => {
    const { store, chair } = await storeWithWheelchairs();
    const day = await today(store);
    await postDevice(store, '/v1/device/rentals', {
      ...RENT,
      serial: 'WC001',
      expectedReturn: plusDays(day, 7),
    });
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [
          cartLine(1, 2_000_000, {
            productId: chair.id,
            variantId: chair.variants[0]!.id,
            name: chair.nameAr,
            qty: 1000,
            serials: ['WC001'],
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results[1]!.flags).toEqual(expect.arrayContaining(['serial_sold_twice']));
    expect(await serialStatus('WC001')).toBe('rented');
  });
});

const CONTRACT = {
  customerName: 'عيادة النور',
  startDate: '2026-01-15',
  endDate: '2026-12-31',
  visitEveryMonths: 3,
  priceMinor: 400_000,
};

describe('a maintenance contract', () => {
  it('names the devices it knows, schedules the visits and logs them', async () => {
    const { store } = await storeWithWheelchairs();
    const made = await post(store, '/v1/maintenance', {
      ...CONTRACT,
      devices: [{ serial: 'bp001' }, { serial: 'OX-9', item: 'مكثف أكسجين' }],
    });
    expect(made.statusCode, made.body).toBe(201);
    const c = made.json<MaintenanceContract>();
    expect(c).toMatchObject({
      number: 'MC-000001',
      devices: [
        { serial: 'BP001', item: 'جهاز ضغط' },
        { serial: 'OX-9', item: 'مكثف أكسجين' },
      ],
      nextVisit: '2026-04-15',
      visits: [],
      billedOn: null,
    });
    const visit = await post(store, `/v1/maintenance/${c.id}/visits`, {
      on: '2026-04-16',
      technician: 'سامر',
      note: 'تبديل فلتر',
      version: c.version,
    });
    expect(visit.statusCode, visit.body).toBe(200);
    expect(visit.json<MaintenanceContract>()).toMatchObject({
      visits: [{ on: '2026-04-16', technician: 'سامر', note: 'تبديل فلتر' }],
      nextVisit: '2026-07-15',
    });
    const stale = await post(store, `/v1/maintenance/${c.id}/visits`, {
      technician: 'سامر',
      version: c.version,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('lists the upcoming and overdue visits with the soonest first', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    // Started three months ago, every three months: the first visit is due today
    const start = plusDays(day, -91);
    const soon = await post(store, '/v1/maintenance', {
      ...CONTRACT,
      customerName: 'عيادة أ',
      devices: [{ serial: 'A1' }],
      startDate: start,
      endDate: plusDays(day, 300),
      visitEveryMonths: 3,
    });
    expect(soon.statusCode, soon.body).toBe(201);
    await post(store, '/v1/maintenance', {
      ...CONTRACT,
      customerName: 'عيادة ب',
      devices: [{ serial: 'B1' }],
      startDate: day,
      endDate: plusDays(day, 400),
    });
    const upcoming = await app.inject({
      method: 'GET',
      url: '/v1/maintenance?view=upcoming',
      headers: as(store),
    });
    expect(upcoming.json<{ items: MaintenanceContract[] }>().items.map((c) => c.customerName)).toEqual([
      'عيادة أ',
    ]);
    const all = await app.inject({ method: 'GET', url: '/v1/maintenance', headers: as(store) });
    expect(all.json<{ items: MaintenanceContract[] }>().items).toHaveLength(2);
  });

  it('renews into a new contract from the day after the end, for as long', async () => {
    const { store } = await storeWithWheelchairs();
    const made = (
      await post(store, '/v1/maintenance', { ...CONTRACT, devices: [{ serial: 'A1' }] })
    ).json<MaintenanceContract>();
    const renewed = await post(store, `/v1/maintenance/${made.id}/renew`, { version: made.version });
    expect(renewed.statusCode, renewed.body).toBe(201);
    expect(renewed.json<MaintenanceContract>()).toMatchObject({
      number: 'MC-000002',
      startDate: '2027-01-01',
      endDate: '2027-12-17',
      priceMinor: 400_000,
      devices: [{ serial: 'A1', item: 'A1' }],
    });
  });

  it('is offered to the till until its price is sold, then marked billed', async () => {
    const { store } = await storeWithWheelchairs();
    const day = await today(store);
    const made = (
      await post(store, '/v1/maintenance', {
        ...CONTRACT,
        devices: [{ serial: 'A1' }],
        startDate: day,
        endDate: plusDays(day, 365),
      })
    ).json<MaintenanceContract>();
    const before = await app.inject({ method: 'GET', url: '/v1/device/maintenance', headers: dev(store) });
    expect(before.json<{ items: MaintenanceContract[] }>().items.map((c) => c.id)).toEqual([made.id]);
    const billed = await postDevice(store, `/v1/device/maintenance/${made.id}/billed`, {
      version: made.version,
    });
    expect(billed.statusCode, billed.body).toBe(200);
    expect(billed.json<MaintenanceContract>().billedOn).toBe(day);
    const after = await app.inject({ method: 'GET', url: '/v1/device/maintenance', headers: dev(store) });
    expect(after.json<{ items: unknown[] }>().items).toEqual([]);
    const [service] = await ownerDb()<
      { type: string }[]
    >`select type from products where name_ar = 'عقد صيانة'`;
    expect(service).toMatchObject({ type: 'service' });
  });
});

describe('contract prices', () => {
  async function setup() {
    const { store, chair, monitor } = await storeWithWheelchairs();
    const hospital = (
      await post(store, '/v1/customers', { name: 'مشفى الأمل', kind: 'hospital', contactName: 'د. سمير' })
    ).json<{ id: string }>();
    const clinic = (await post(store, '/v1/customers', { name: 'عيادة النور', kind: 'clinic' })).json<{
      id: string;
    }>();
    return {
      store,
      chairVariant: chair.variants[0]!.id,
      monitorVariant: monitor.variants[0]!.id,
      hospital,
      clinic,
    };
  }
  const forTill = async (store: Store, customerId: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/v1/device/contract-prices?customerId=${customerId}`,
        headers: dev(store),
      })
    ).json<{ items: ContractPriceForTill[] }>().items;

  it('prices a product for one customer or for a type, with the customer’s own winning', async () => {
    const { store, chairVariant, monitorVariant, hospital, clinic } = await setup();
    const day = await today(store);
    const kindPrice = await post(store, '/v1/contract-prices', {
      customerKind: 'hospital',
      variantId: chairVariant,
      priceMinor: 1_800_000,
      validFrom: plusDays(day, -30),
    });
    expect(kindPrice.statusCode, kindPrice.body).toBe(201);
    await post(store, '/v1/contract-prices', {
      customerId: hospital.id,
      variantId: chairVariant,
      priceMinor: 1_700_000,
      validFrom: plusDays(day, -1),
    });
    await post(store, '/v1/contract-prices', {
      customerKind: 'hospital',
      variantId: monitorVariant,
      priceMinor: 400_000,
      validFrom: plusDays(day, -30),
    });
    expect(await forTill(store, hospital.id)).toEqual(
      expect.arrayContaining([
        { variantId: chairVariant, currency: 'SYP', priceMinor: 1_700_000 },
        { variantId: monitorVariant, currency: 'SYP', priceMinor: 400_000 },
      ]),
    );
    expect(await forTill(store, clinic.id)).toEqual([]);
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/contract-prices?customerId=${hospital.id}`,
      headers: as(store),
    });
    expect(listed.json<{ items: ContractPrice[] }>().items).toMatchObject([
      { customerName: 'مشفى الأمل', item: 'كرسي متحرك', priceMinor: 1_700_000 },
    ]);
  });

  it('applies only between its two days', async () => {
    const { store, chairVariant, hospital } = await setup();
    const day = await today(store);
    const expired = await post(store, '/v1/contract-prices', {
      customerId: hospital.id,
      variantId: chairVariant,
      priceMinor: 1,
      validFrom: plusDays(day, -20),
      validTo: plusDays(day, -1),
    });
    const future = await post(store, '/v1/contract-prices', {
      customerId: hospital.id,
      variantId: chairVariant,
      priceMinor: 2,
      validFrom: plusDays(day, 1),
    });
    expect([expired.statusCode, future.statusCode]).toEqual([201, 201]);
    expect(await forTill(store, hospital.id)).toEqual([]);
    const ends = await post(store, '/v1/contract-prices', {
      customerId: hospital.id,
      variantId: chairVariant,
      priceMinor: 3,
      validFrom: day,
      validTo: day,
    });
    expect(ends.statusCode).toBe(201);
    expect((await forTill(store, hospital.id)).map((p) => p.priceMinor)).toEqual([3]);
  });

  it('is edited and deleted, and refuses a price for nobody or for a missing product', async () => {
    const { store, chairVariant, hospital } = await setup();
    const day = await today(store);
    const made = (
      await post(store, '/v1/contract-prices', {
        customerId: hospital.id,
        variantId: chairVariant,
        priceMinor: 1_700_000,
        validFrom: day,
      })
    ).json<ContractPrice>();
    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/contract-prices/${made.id}`,
      headers: as(store),
      payload: {
        version: made.version,
        customerId: hospital.id,
        variantId: chairVariant,
        priceMinor: 1_600_000,
        validFrom: day,
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json<ContractPrice>().priceMinor).toBe(1_600_000);
    const stale = await app.inject({
      method: 'PUT',
      url: `/v1/contract-prices/${made.id}`,
      headers: as(store),
      payload: {
        version: made.version,
        customerId: hospital.id,
        variantId: chairVariant,
        priceMinor: 1,
        validFrom: day,
      },
    });
    expect(stale.statusCode).toBe(409);
    const nobody = await post(store, '/v1/contract-prices', {
      variantId: chairVariant,
      priceMinor: 1,
      validFrom: day,
    });
    expect(nobody.statusCode).toBe(400);
    const noProduct = await post(store, '/v1/contract-prices', {
      customerId: hospital.id,
      variantId: '0192e0a0-0000-7000-8000-000000000001',
      priceMinor: 1,
      validFrom: day,
    });
    expect(noProduct.statusCode).toBe(400);
    const gone = await app.inject({
      method: 'DELETE',
      url: `/v1/contract-prices/${made.id}`,
      headers: as(store),
    });
    expect(gone.statusCode).toBe(204);
    expect(await forTill(store, hospital.id)).toEqual([]);
    const again = await app.inject({
      method: 'DELETE',
      url: `/v1/contract-prices/${made.id}`,
      headers: as(store),
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('customer type', () => {
  it('is kept with the contact and filters the list', async () => {
    const store = await openStore(app);
    await post(store, '/v1/customers', {
      name: 'مشفى الأمل',
      kind: 'hospital',
      contactName: 'د. سمير',
      contactPhone: '0944111222',
    });
    await post(store, '/v1/customers', { name: 'عيادة النور', kind: 'clinic' });
    await post(store, '/v1/customers', { name: 'زبون عادي' });
    const hospitals = await app.inject({
      method: 'GET',
      url: '/v1/customers?kind=hospital',
      headers: as(store),
    });
    expect(hospitals.json<CustomerListResponse>().items).toMatchObject([
      { name: 'مشفى الأمل', kind: 'hospital', contactName: 'د. سمير', contactPhone: '0944111222' },
    ]);
    const all = await app.inject({ method: 'GET', url: '/v1/customers', headers: as(store) });
    expect(
      all
        .json<CustomerListResponse>()
        .items.map((c) => c.kind)
        .sort(),
    ).toEqual(['clinic', 'hospital', null]);
    const bad = await post(store, '/v1/customers', { name: 'س', kind: 'shop' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('debt ageing', () => {
  it('splits what each customer owes by the age of the debt, oldest paid first', async () => {
    const store = await openStore(app);
    const customer = async (name: string) =>
      (await post(store, '/v1/customers', { name })).json<{ id: string }>().id;
    const debt = (id: string, amountMinor: number, date: string) =>
      post(store, `/v1/customers/${id}/opening-debt`, { amountMinor, date });
    const a = await customer('زبون أ');
    const b = await customer('زبون ب');
    const paid = await customer('زبون مسدد');
    await debt(a, 1_000, '2026-06-01');
    await debt(a, 500, '2026-09-20');
    await debt(a, 300, '2026-11-10');
    const payment = await post(store, `/v1/customers/${a}/payments`, {
      amountMinor: 1_200,
      method: 'cash',
      date: '2026-10-01',
    });
    expect(payment.statusCode, payment.body).toBe(201);
    await debt(b, 700, '2026-01-01');
    await debt(paid, 100, '2026-10-01');
    await post(store, `/v1/customers/${paid}/payments`, {
      amountMinor: 100,
      method: 'cash',
      date: '2026-10-05',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/debt-ageing?asOf=2026-11-13',
      headers: as(store),
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json<DebtAgeingReport>();
    expect(report.items.map((r) => [r.name, r.balanceMinor, r.buckets])).toEqual([
      ['زبون ب', 700, { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 700 }],
      ['زبون أ', 600, { d0_30: 300, d31_60: 300, d61_90: 0, d90_plus: 0 }],
    ]);
    expect(report.totals).toEqual({ d0_30: 300, d31_60: 300, d61_90: 0, d90_plus: 700, balanceMinor: 1_300 });
    expect(report.asOf).toBe('2026-11-13');
  });

  it('only reads: it posts nothing', async () => {
    const store = await openStore(app);
    const before = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    await app.inject({ method: 'GET', url: '/v1/reports/debt-ageing', headers: as(store) });
    const after = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
