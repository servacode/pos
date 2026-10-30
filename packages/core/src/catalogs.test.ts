import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS } from './permissions';
import { SECTORS, SECTOR_KEYS, sectorLabel, type SectorKey } from './sectors';

describe('sectors', () => {
  it('lists unique keys with Arabic labels', () => {
    expect(new Set(SECTOR_KEYS).size).toBe(SECTORS.length);
    expect(SECTOR_KEYS).toContain('general');
    expect(sectorLabel('cafe')).toBe('مقهى وكافتيريا');
  });

  it('falls back to the key for an unknown sector', () => {
    expect(sectorLabel('kiosk' as SectorKey)).toBe('kiosk');
  });
});

describe('default roles', () => {
  const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key);

  it('gives the owner every permission', () => {
    expect(ALL_PERMISSIONS).toEqual(Object.keys(PERMISSIONS));
    expect(role('owner')?.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('keeps users, WhatsApp and the subscription with the owner only', () => {
    const manager = role('manager')?.permissions ?? [];
    expect(manager).not.toContain('users.manage');
    expect(manager).not.toContain('whatsapp.manage');
    expect(manager).not.toContain('subscription.manage');
    expect(manager).toContain('reports.financial');
    expect(manager).toHaveLength(ALL_PERMISSIONS.length - 3);
  });

  it('limits the cashier to selling with a 10% discount', () => {
    expect(role('cashier')).toEqual({
      key: 'cashier',
      nameAr: 'كاشير',
      permissions: ['sale.create', 'sale.discount', 'shift.close_own'],
      maxDiscountBp: 1000,
    });
  });
});
