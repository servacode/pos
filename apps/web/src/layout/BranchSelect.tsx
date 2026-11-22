import { StoreIcon } from '@serva/ui';
import { setBranchScope } from './branchScope';

/**
 * The branch filter (round 54): «كل الفروع» or one branch, for every figure on the home page. A real
 * select, so it works with the keyboard and a screen reader; one branch (or a person tied to one) gets
 * plain words instead.
 */
export function BranchSelect({
  branches,
  value,
  className = 'sh-branch',
}: {
  branches: { id: string; name: string }[];
  value: string | null;
  className?: string;
}) {
  return (
    <label className={className}>
      <StoreIcon size={20} />
      <span className="sr-only">الفرع</span>
      <select
        className="sh-branch-select"
        value={value ?? ''}
        onChange={(event) => setBranchScope(event.target.value || null)}
      >
        <option value="">كل الفروع</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
