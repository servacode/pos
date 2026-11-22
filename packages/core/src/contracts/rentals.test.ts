import { describe, expect, it } from 'vitest';
import { contractPriceInput } from './contract-prices';
import { customerInput } from './customers';
import { maintenanceInput } from './maintenance';
import { rentalInput } from './rentals';

const rental = {
  serial: 'WC-1',
  customerName: 'مشفى الأمل',
  phone: '0956666790',
  expectedReturn: '2026-12-01',
  rateUnit: 'week',
  rateMinor: 50_000,
};

describe('rentalInput', () => {
  it('takes a plain rental with no deposit', () => {
    const r = rentalInput.safeParse(rental);
    expect(r.success).toBe(true);
    expect(r.success && r.data.depositMinor).toBe(0);
  });
  it('wants a deposit to name its voucher', () => {
    expect(rentalInput.safeParse({ ...rental, depositMinor: 1000 }).success).toBe(false);
    expect(rentalInput.safeParse({ ...rental, depositMinor: 1000, depositVoucher: 'GV-1' }).success).toBe(
      true,
    );
  });
  it('refuses a return before the start', () => {
    expect(rentalInput.safeParse({ ...rental, startDate: '2026-12-05' }).success).toBe(false);
    expect(rentalInput.safeParse({ ...rental, startDate: '2026-11-20' }).success).toBe(true);
  });
});

describe('maintenanceInput', () => {
  const contract = {
    customerName: 'عيادة النور',
    devices: [{ serial: 'OX-1' }],
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    visitEveryMonths: 3,
    priceMinor: 100_000,
  };
  it('needs an end after the start and a device', () => {
    expect(maintenanceInput.safeParse(contract).success).toBe(true);
    expect(maintenanceInput.safeParse({ ...contract, endDate: '2025-12-31' }).success).toBe(false);
    expect(maintenanceInput.safeParse({ ...contract, devices: [] }).success).toBe(false);
  });
});

describe('contractPriceInput', () => {
  const id = '0192e0a0-0000-7000-8000-000000000001';
  const price = { variantId: id, priceMinor: 900, validFrom: '2026-01-01' };
  it('is for one customer or one type, not both nor neither', () => {
    expect(contractPriceInput.safeParse({ ...price, customerId: id }).success).toBe(true);
    expect(contractPriceInput.safeParse({ ...price, customerKind: 'hospital' }).success).toBe(true);
    expect(contractPriceInput.safeParse(price).success).toBe(false);
    expect(contractPriceInput.safeParse({ ...price, customerId: id, customerKind: 'clinic' }).success).toBe(
      false,
    );
  });
  it('ends no earlier than it starts', () => {
    const base = { ...price, customerKind: 'hospital' as const };
    expect(contractPriceInput.safeParse({ ...base, validTo: '2025-12-31' }).success).toBe(false);
    expect(contractPriceInput.safeParse({ ...base, validTo: '2026-06-30' }).success).toBe(true);
  });
});

describe('customerInput kind', () => {
  it('takes a kind and contact', () => {
    const r = customerInput.safeParse({ name: 'عيادة النور', kind: 'clinic', contactName: 'د. سمير' });
    expect(r.success).toBe(true);
    expect(customerInput.safeParse({ name: 'عيادة النور', kind: 'shop' }).success).toBe(false);
  });
});
