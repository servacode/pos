import type { MeResponse } from '@serva/core';
import { Select } from '@serva/ui';
import { branchChoices } from '../reports/parts';

/**
 * Round 36 (X1): the branch a customer's payment from the admin comes to. The branches this user
 * may use; the one they are tied to, or the only one, comes first.
 */
export function defaultPaymentBranch(me: MeResponse): string {
  const { branches } = branchChoices(me);
  const tied = me.user.roles.find((role) => role.branchId !== null)?.branchId ?? null;
  return (branches.find((b) => b.id === tied) ?? branches[0])?.id ?? '';
}

export function PaymentBranchField({
  me,
  value,
  onChange,
  error,
}: {
  me: MeResponse;
  value: string;
  onChange: (branchId: string) => void;
  error?: string | undefined;
}) {
  const { branches } = branchChoices(me);
  // A store with one branch has nothing to choose: the payment goes to it, unasked
  if (branches.length <= 1) return null;
  return (
    <Select
      label="الفرع"
      hint="يظهر القبض في تقارير هذا الفرع"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );
}
