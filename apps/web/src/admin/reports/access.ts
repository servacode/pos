import type { MeResponse, Permission } from '@serva/core';

/**
 * Keys the reports screens read. `report.view` and `accounting.view` are added by the step-5
 * server (09 › الصلاحيات lists accounting.view; the brief names report.view); until they are in
 * @serva/core's PERMISSIONS, they are read here as plain strings. The server checks every request
 * again: these only decide what the menu shows.
 */
export type AccessKey = Permission | 'report.view' | 'accounting.view';

export type AccessRule = readonly AccessKey[];

/**
 * «مبيعات اليوم»: report.view alone, the key the server checks (services/reports.ts › branchFilter).
 * reports.financial is the profit key, a different one: holding it opens nothing here.
 */
export const DAY_REPORT_ACCESS: AccessRule = ['report.view'];
/**
 * «الورديات»: report.view alone, as the server's list and close report ask. shift.close_any is for
 * closing a shift at the till; it does not open the list.
 */
export const SHIFTS_ACCESS: AccessRule = ['report.view'];
/** Accounting (12 › المحاسبة): the books are for accounting.view alone, in accounting mode. */
export const ACCOUNTING_ACCESS: AccessRule = ['accounting.view'];
/** «شاشة الدليل»: the owner and the manager, who see the devices. */
export const EVIDENCE_ACCESS: AccessRule = ['devices.view'];

type AccessSubject = Pick<MeResponse, 'user' | 'settings'>;

export function holdsAny(me: AccessSubject, rule: AccessRule): boolean {
  const held: readonly string[] = me.user.permissions;
  return rule.some((key) => held.includes(key));
}

/**
 * Accounting mode (12, 14, 19): accounting words show only there. The store setting is not in
 * /v1/me yet; until it is, holding accounting.view is the mode, and an explicit
 * `accountingMode: false` hides it.
 */
export function inAccountingMode(me: AccessSubject): boolean {
  const setting = (me.settings as { accountingMode?: boolean }).accountingMode;
  return setting !== false && holdsAny(me, ACCOUNTING_ACCESS);
}

/** The cash difference (09 › shift.view_difference); the server also leaves it out for others. */
export function seesDifference(me: AccessSubject): boolean {
  return holdsAny(me, ['shift.view_difference']);
}
