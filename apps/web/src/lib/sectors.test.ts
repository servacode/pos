import { describe, expect, it } from 'vitest';
import { CHEQUE_SECTORS, EXPIRY_SECTORS, SERIAL_SECTORS, storeSells } from './sectors';

describe('what a medical supplies store sees', () => {
  const store = ['medical_supplies' as const];

  it('sees expiry dates for consumables, serial numbers for devices and cheques', () => {
    expect(storeSells(store, EXPIRY_SECTORS)).toBe(true);
    expect(storeSells(store, SERIAL_SECTORS)).toBe(true);
    expect(storeSells(store, CHEQUE_SECTORS)).toBe(true);
  });

  it('a clothing store sees none of them, a store with no type sees all', () => {
    expect(storeSells(['clothing'], EXPIRY_SECTORS)).toBe(false);
    expect(storeSells(['clothing'], SERIAL_SECTORS)).toBe(false);
    expect(storeSells([], SERIAL_SECTORS)).toBe(true);
    expect(storeSells(undefined, CHEQUE_SECTORS)).toBe(true);
  });
});
