import type { InventoryResponse, StocktakeListRow } from '@serva/core';
import { Button } from '@serva/ui';
import { Amt, Panel, StatusPill, SxTable, type SxColumn } from '../sales/ui';

const kindWord = (kind: StocktakeListRow['kind']) =>
  kind === 'waste' ? 'هدر' : kind === 'shortage' ? 'نقص تحويل' : 'جرد';

/** «الجرد السابق»: the counts already made, as a table (cards on a phone) with «اعرض الأقدم». */
export function InventoryPast({
  past,
  pastNext,
  pastError,
  phone,
  base,
  loadPast,
}: {
  past: StocktakeListRow[];
  pastNext: string | null;
  pastError: string | null;
  phone: boolean;
  base: InventoryResponse['baseCurrency'];
  loadPast: (cursor: string | null) => void;
}) {
  const pastColumns: SxColumn<StocktakeListRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      lead: true,
      cell: (r) => (
        <bdi dir="ltr" className="sx-n">
          {r.number}
        </bdi>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (r) => <span className="sx-mute sx-n">{r.date}</span> },
    {
      key: 'kind',
      header: 'النوع',
      cell: (r) => <StatusPill kind={r.kind === 'count' ? 'ok' : 'warn'}>{kindWord(r.kind)}</StatusPill>,
    },
    { key: 'branch', header: 'الفرع', hideBelowLg: true, cell: (r) => r.branchName },
    { key: 'by', header: 'بواسطة', hideBelowLg: true, cell: (r) => r.by || '—' },
    {
      key: 'items',
      header: 'الأصناف',
      numeric: true,
      cell: (r) => <span className="sx-n">{r.items.toLocaleString('en-US')}</span>,
    },
    {
      key: 'diff',
      header: 'الفرق بالقيمة',
      numeric: true,
      strong: true,
      cell: (r) =>
        r.diffValueMinor === 0 ? (
          <span className="sx-sub">مطابق</span>
        ) : (
          <Amt minor={r.diffValueMinor} currency={base} neg={r.diffValueMinor < 0} />
        ),
    },
  ];
  return (
    <Panel title="الجرد السابق" flush>
      {phone ? (
        <ul className="sx-cards" aria-label="الجرد السابق على الهاتف" style={{ padding: 12 }}>
          {past.map((r) => (
            <li key={r.id} className="ix-icard">
              <span className="n">
                <bdi dir="ltr" className="sx-n">
                  {r.number}
                </bdi>
                <span className="sx-subline">
                  <span className="sx-n">{r.date}</span> · {r.branchName}
                  {r.by ? ` · ${r.by}` : ''}
                </span>
              </span>
              <span className="v">
                {r.diffValueMinor === 0 ? (
                  <span className="sx-sub">مطابق</span>
                ) : (
                  <Amt minor={r.diffValueMinor} currency={base} neg={r.diffValueMinor < 0} />
                )}
              </span>
              <span className="q">
                <StatusPill kind={r.kind === 'count' ? 'ok' : 'warn'}>{kindWord(r.kind)}</StatusPill>
                <span>
                  <bdi className="sx-n">{r.items.toLocaleString('en-US')}</bdi> صنفاً
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <SxTable
          bare
          caption="الجرد السابق"
          columns={pastColumns}
          rows={past}
          rowKey={(r) => r.id}
          error={pastError ?? undefined}
          onRetry={() => loadPast(null)}
        />
      )}
      {pastNext ? (
        <div className="flex justify-center" style={{ padding: 12 }}>
          <Button variant="secondary" onClick={() => loadPast(pastNext)}>
            اعرض الأقدم
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
