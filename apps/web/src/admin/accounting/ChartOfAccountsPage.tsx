import { useMemo, useState } from 'react';
import { normalizeArabic } from '@serva/core';
import { Badge, Button, Card, cn, EmptyState, ExpandIcon, ReportsIcon, SearchField } from '@serva/ui';
import { listAccounts } from '../reports/api';
import type { AccountRow } from '../reports/contracts';
import { ACCOUNT_TYPE_LABEL, currencyName, normalSide } from '../reports/labels';
import { ReportError, ReportLoading } from '../reports/parts';
import { useReport } from '../reports/useReport';
import { AccountingLayout } from './AccountingLayout';

export interface AccountNode {
  account: AccountRow;
  children: AccountNode[];
}

/** The chart as a tree by `parentCode`, each level in code order; an orphan becomes a root. */
export function accountTree(accounts: readonly AccountRow[]): AccountNode[] {
  const nodes = new Map(accounts.map((account) => [account.code, { account, children: [] } as AccountNode]));
  const roots: AccountNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.account.parentCode ? nodes.get(node.account.parentCode) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const byCode = (a: AccountNode, b: AccountNode) => a.account.code.localeCompare(b.account.code, 'en');
  const sort = (list: AccountNode[]) => {
    list.sort(byCode);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

interface VisibleRow {
  node: AccountNode;
  depth: number;
  expanded: boolean;
}

function matches(account: AccountRow, query: string): boolean {
  if (account.code.startsWith(query)) return true;
  return (
    normalizeArabic(account.name).includes(query) || normalizeArabic(account.nameEn ?? '').includes(query)
  );
}

/** The rows on screen: open groups show their children; a search shows each match with its parents. */
function visibleRows(roots: AccountNode[], open: ReadonlySet<string>, query: string): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const keep = (node: AccountNode): boolean =>
    query === '' || matches(node.account, query) || node.children.some(keep);
  const walk = (list: AccountNode[], depth: number) => {
    for (const node of list) {
      if (!keep(node)) continue;
      const expanded = node.children.length > 0 && (query !== '' || open.has(node.account.code));
      rows.push({ node, depth, expanded });
      if (expanded) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

function groupCodes(roots: AccountNode[]): string[] {
  const codes: string[] = [];
  const walk = (list: AccountNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) codes.push(node.account.code);
      walk(node.children);
    }
  };
  walk(roots);
  return codes;
}

function AccountTree({ accounts }: { accounts: AccountRow[] }) {
  const roots = useMemo(() => accountTree(accounts), [accounts]);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(roots.map((node) => node.account.code)),
  );
  const [search, setSearch] = useState('');
  const query = normalizeArabic(search);
  const rows = visibleRows(roots, open, query);

  const toggle = (code: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField
          label="ابحث في الحسابات"
          placeholder="ابحث بالرمز أو الاسم"
          value={search}
          onValueChange={setSearch}
          className="w-full max-w-sm"
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(new Set(groupCodes(roots)))}>
            وسّع الكل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(new Set())}>
            اطوِ الكل
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table aria-label="شجرة الحسابات" className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-11 border-b border-line bg-surface-muted text-[0.8125rem] text-ink-muted">
              <th scope="col" className="px-3 text-start font-semibold">
                الحساب
              </th>
              <th scope="col" className="px-3 text-start font-semibold">
                النوع
              </th>
              <th scope="col" className="px-3 text-start font-semibold">
                الطبيعة
              </th>
              <th scope="col" className="px-3 text-start font-semibold">
                العملة
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-ink-muted">
                  لا حساب بهذا الاسم أو الرمز.
                </td>
              </tr>
            ) : null}
            {rows.map(({ node, depth, expanded }) => {
              const { account } = node;
              const group = node.children.length > 0;
              return (
                <tr key={account.id} className="h-11 border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-3">
                    <div
                      className="flex items-center gap-2"
                      style={{ paddingInlineStart: `${depth * 1.5}rem` }}
                    >
                      {group ? (
                        <button
                          type="button"
                          onClick={() => toggle(account.code)}
                          aria-expanded={expanded}
                          aria-label={`${account.code} ${account.name}`}
                          className="-my-1 grid size-9 place-items-center rounded-control text-ink-muted hover:bg-surface-muted"
                        >
                          <ExpandIcon
                            size={16}
                            className={cn('transition-transform', !expanded && 'rotate-90')}
                          />
                        </button>
                      ) : (
                        <span className="size-9" aria-hidden="true" />
                      )}
                      <bdi className="num font-semibold text-ink-muted">{account.code}</bdi>
                      <span className={cn('text-ink', (account.isGroup || group) && 'font-bold')}>
                        {account.name}
                      </span>
                      {account.isSystem ? <Badge>من النظام</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 text-ink-muted">{ACCOUNT_TYPE_LABEL[account.type]}</td>
                  <td className="px-3 text-ink-muted">
                    {account.isGroup ? 'تجميعي' : normalSide(account.type) === 'debit' ? 'مدين' : 'دائن'}
                  </td>
                  <td className="px-3 text-ink-muted">
                    {account.currency ? currencyName(account.currency) : 'كل العملات'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-muted">
        الدليل الافتراضي من سجل الترقيم، وأرقامه ثابتة. حسابات النظام تتحرك من المستندات وحدها.
      </p>
    </div>
  );
}

/** «دليل الحسابات» (10 › دليل الحسابات الافتراضي; admin/ChartJournal › شجرة الحسابات). */
export function ChartOfAccountsPage() {
  const { data, error, loading, retry } = useReport('accounts', listAccounts);
  return (
    <AccountingLayout title="دليل الحسابات">
      {loading ? <ReportLoading label="نحمّل دليل الحسابات…" /> : null}
      {error ? <ReportError message={error} onRetry={retry} /> : null}
      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState icon={ReportsIcon} title="لا حسابات في الدليل بعد." />
        </Card>
      ) : null}
      {data && data.items.length > 0 ? <AccountTree accounts={data.items} /> : null}
    </AccountingLayout>
  );
}
