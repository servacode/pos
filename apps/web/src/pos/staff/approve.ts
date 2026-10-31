import type { Permission } from '@serva/core';
import type { Approval } from '@serva/core/contracts/documents';
import { checkCode, type CodeCheck, type SignInDeps, type StaffMember } from './staff';

/**
 * The manager's code (11 › ما يحتاج موافقة; 16: رمز المدير 6 أرقام): someone present whose role
 * grants the permission types their own code on this device. Offline it works only for a manager
 * who has signed in online on this device once (contract Q1).
 */

export function approversFor(staff: readonly StaffMember[], permission: Permission): StaffMember[] {
  return staff.filter((m) => m.permissions.has(permission) && m.pinLength === 6);
}

export type ApprovalCheck =
  { ok: true; approval: Approval; approver: StaffMember } | Exclude<CodeCheck, { ok: true }>;

export async function approveWithCode(
  deps: SignInDeps,
  approver: StaffMember,
  pin: string,
): Promise<ApprovalCheck> {
  const result = await checkCode(deps, approver, pin);
  if (!result.ok) return result;
  return {
    ok: true,
    approver,
    approval: {
      userId: approver.id,
      method: 'pin',
      at: new Date(deps.now()).toISOString(),
      offline: result.session.offline,
    },
  };
}
