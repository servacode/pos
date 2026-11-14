import { useMemo, useState } from 'react';
import { normalizeArabic } from '@serva/core';
import {
  Badge,
  Button,
  cn,
  DataTable,
  EmptyState,
  ExpandIcon,
  IconButton,
  InfoIcon,
  ReportsIcon,
  SearchField,
  SearchIcon,
  type DataColumn,
} from '@serva/ui';
import { listAccounts } from '../reports/api';
import type { AccountRow } from '../reports/contracts';
import { ACCOUNT_TYPE_LABEL, currencyName, normalSide } from '../reports/labels';
import { ReportError } from '../reports/parts';
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

/** A secondary column's words: the type, the side, the currency. */
function Muted({ children }: { children: string }) {
  return <span className="whitespace-nowrap text-ink-muted">{children}</span>;
}

const plural = new Intl.PluralRules('ar');

/** «حساب واحد», «حسابان», «5 حسابات», «30 حساباً», «100 حساب». */
function AccountsCount({ count }: { count: number }) {
  const number = <bdi className="num font-semibold text-ink">{count}</bdi>;
  switch (plural.select(count)) {
    case 'one':
      return <>حساب واحد</>;
    case 'two':
      return <>حسابان</>;
    case 'few':
      return <>{number} حسابات</>;
    case 'many':
      return <>{number} حساباً</>;
    default:
      return <>{number} حساب</>;
  }
}

/** Each level of the tree steps in by this much (rem), so a child sits under its parent's name. */
const INDENT = 1.75;

/**
 * The account cell of the tree (هوية 4 › DataTable): stepped in by its depth, a chevron that opens
 * and closes a group (a leaf keeps its place), the code in equal-width digits, then the name. A main
 * group is bold, a sub-group semibold, an account plain, so the levels read at a glance.
 */
function AccountCell({ row, onToggle }: { row: VisibleRow; onToggle: (code: string) => void }) {
  const { node, depth, expanded } = row;
  const { account } = node;
  const group = node.children.length > 0;
  return (
    <div className="flex items-center gap-2" style={{ paddingInlineStart: `${depth * INDENT}rem` }}>
      {group ? (
        <IconButton
          label={`${account.code} ${account.name}`}
          aria-expanded={expanded}
          size="xs"
          onClick={() => onToggle(account.code)}
          icon={
            <ExpandIcon
              size={16}
              className={cn(
                'motion-safe:transition-transform motion-safe:duration-120',
                !expanded && 'rotate-90',
              )}
            />
          }
        />
      ) : (
        // As wide as the chevron button beside a group (IconButton xs), so names line up.
        <span aria-hidden="true" className="size-8 shrink-0 pointer-coarse:size-12" />
      )}
      <bdi className="num min-w-10 text-ink-subtle">{account.code}</bdi>
      <span
        className={cn(
          'text-ink',
          depth === 0 && (account.isGroup || group)
            ? 'font-bold'
            : account.isGroup || group
              ? 'font-semibold'
              : null,
        )}
      >
        {account.name}
      </span>
      {account.isSystem ? (
        <Badge dot={false} className="max-sm:hidden">
          من النظام
        </Badge>
      ) : null}
    </div>
  );
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

  const columns: DataColumn<VisibleRow>[] = [
    {
      key: 'account',
      header: 'الحساب',
      cell: (row) => <AccountCell row={row} onToggle={toggle} />,
    },
    {
      key: 'type',
      header: 'النوع',
      // The tree already says it on a phone: each account sits under its type.
      className: 'hidden md:table-cell',
      cell: ({ node }) => <Muted>{ACCOUNT_TYPE_LABEL[node.account.type]}</Muted>,
    },
    {
      key: 'side',
      header: 'الطبيعة',
      cell: ({ node }) => (
        <Muted>
          {node.account.isGroup ? 'تجميعي' : normalSide(node.account.type) === 'debit' ? 'مدين' : 'دائن'}
        </Muted>
      ),
    },
    {
      key: 'currency',
      header: 'العملة',
      className: 'hidden sm:table-cell',
      cell: ({ node }) => (
        <Muted>{node.account.currency ? currencyName(node.account.currency) : 'كل العملات'}</Muted>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          label="ابحث في الحسابات"
          placeholder="ابحث بالرمز أو الاسم"
          value={search}
          onValueChange={setSearch}
          className="min-w-0 flex-1 basis-64 sm:max-w-md"
        />
        <p className="text-sm text-ink-muted max-sm:hidden">
          <AccountsCount count={accounts.length} /> في الدليل
        </p>
        <div className="ms-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(new Set(groupCodes(roots)))}>
            وسّع الكل
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(new Set())}>
            اطوِ الكل
          </Button>
        </div>
      </div>
      <DataTable
        caption="شجرة الحسابات"
        columns={columns}
        rows={rows}
        rowKey={({ node }) => node.account.id}
        empty={
          <EmptyState
            icon={SearchIcon}
            title="لا حساب بهذا الاسم أو الرمز."
            description="جرّب جزءاً من الاسم، أو أول أرقام الرمز."
          />
        }
      />
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <InfoIcon size={16} className="mt-0.5" />
        الدليل الافتراضي من سجل الترقيم، وأرقامه ثابتة. حسابات النظام تتحرك من المستندات وحدها.
      </p>
    </div>
  );
}

/** The tree's columns while the chart loads: the same heads over grey lines. */
const LOADING_COLUMNS: DataColumn<never>[] = [
  { key: 'account', header: 'الحساب' },
  { key: 'type', header: 'النوع' },
  { key: 'side', header: 'الطبيعة' },
  { key: 'currency', header: 'العملة' },
];

/** «دليل الحسابات» (10 › دليل الحسابات الافتراضي; admin/ChartJournal › شجرة الحسابات). */
export function ChartOfAccountsPage() {
  const { data, error, loading, retry } = useReport('accounts', listAccounts);
  return (
    <AccountingLayout title="دليل الحسابات">
      {loading ? (
        <DataTable
          caption="نحمّل دليل الحسابات…"
          columns={LOADING_COLUMNS}
          rows={[]}
          rowKey={() => ''}
          loading
        />
      ) : null}
      {error ? <ReportError message={error} onRetry={retry} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          icon={ReportsIcon}
          title="لا حسابات في الدليل بعد."
          description="يظهر هنا دليل الحسابات حين يُفعَّل وضع المحاسبة."
        />
      ) : null}
      {data && data.items.length > 0 ? <AccountTree accounts={data.items} /> : null}
    </AccountingLayout>
  );
}
