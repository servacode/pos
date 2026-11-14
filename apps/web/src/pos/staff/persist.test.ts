import { afterEach, describe, expect, it } from 'vitest';
import { forgetSession, keepSession, restoreSession, touchSession } from './persist';
import type { StaffMember, StaffSession } from './staff';

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u1',
  fullName: 'سامر',
  pinLength: 4,
  pinVersion: 1,
  roleNames: ['كاشير'],
  permissions: new Set(['sale.create', 'sale.refund']) as StaffMember['permissions'],
  maxDiscountBp: 500,
  ...over,
});
const session = (): StaffSession => ({
  userId: 'u1',
  fullName: 'سامر',
  roleNames: ['كاشير'],
  permissions: new Set(['sale.create', 'sale.refund']) as StaffSession['permissions'],
  maxDiscountBp: 500,
  offline: false,
});
const MIN = 60_000;

afterEach(() => forgetSession());

describe('keeping the signed-in person across a reload', () => {
  it('brings the same person back within the idle window, and only the idle window', () => {
    keepSession(session(), member(), 'dev-1', 1_000_000);
    expect(restoreSession([member()], 'dev-1', 1_000_000 + 4 * MIN, 5)?.userId).toBe('u1');
    keepSession(session(), member(), 'dev-1', 1_000_000);
    expect(restoreSession([member()], 'dev-1', 1_000_000 + 6 * MIN, 5)).toBeNull();
    // Expired: it is gone, not just refused once
    expect(restoreSession([member()], 'dev-1', 1_000_000 + MIN, 5)).toBeNull();
  });

  it('a touch starts the window again', () => {
    keepSession(session(), member(), 'dev-1', 0);
    touchSession(4 * MIN);
    expect(restoreSession([member()], 'dev-1', 8 * MIN, 5)?.userId).toBe('u1');
  });

  it('never brings back another device’s person, a changed code, a removed person or a locked till', () => {
    keepSession(session(), member(), 'dev-1', 0);
    expect(restoreSession([member()], 'dev-2', MIN, 5)).toBeNull();
    keepSession(session(), member(), 'dev-1', 0);
    expect(restoreSession([member({ pinVersion: 2 })], 'dev-1', MIN, 5)).toBeNull();
    keepSession(session(), member(), 'dev-1', 0);
    expect(restoreSession([], 'dev-1', MIN, 5)).toBeNull();
    keepSession(session(), member(), 'dev-1', 0);
    forgetSession();
    expect(restoreSession([member()], 'dev-1', MIN, 5)).toBeNull();
    // No idle limit set (0): nothing is kept
    keepSession(session(), member(), 'dev-1', 0);
    expect(restoreSession([member()], 'dev-1', MIN, 0)).toBeNull();
  });

  it('gives back no more than the roles allow now, and keeps no code', () => {
    keepSession(session(), member(), 'dev-1', 0);
    const back = restoreSession(
      [member({ permissions: new Set(['sale.create']) as StaffMember['permissions'], maxDiscountBp: 200 })],
      'dev-1',
      MIN,
      5,
    )!;
    expect([...back.permissions]).toEqual(['sale.create']);
    expect(back.maxDiscountBp).toBe(200);
    expect(JSON.stringify(globalThis.sessionStorage)).not.toMatch(/pin"|2580/);
  });
});
