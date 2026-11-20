import { useState } from 'react';
import type { VoucherListRow } from '@serva/core';
import { GiftIcon, useDigits } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay } from '../../lib/dates';
import { Pager, useCursorPages } from '../pager';
import { Amt, Panel, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { listVouchers } from './api';
import { CheckChip, Empty } from './parts';

const KIND_TEXT: Record<string, string> = { exchange: 'قسيمة استبدال', gift: 'قسيمة هدية', deposit: 'عربون' };

/**
 * «القسائم»: the exchange and gift vouchers the store has issued and what is left on each, which is
 * what the store still owes (the 2310 account). Read only: the till issues them and takes them.
 */
export function VouchersPanel() {
  const me = useMe();
  const digits = useDigits();
  const [all, setAll] = useState(false);
  const status = all ? 'all' : 'open';
  const { data, error, loading, retry, pager, topRef } = useCursorPages(status, (cursor) =>
    listVouchers(status, cursor),
  );
  const items = data?.items ?? [];

  const columns: SxColumn<VoucherListRow>[] = [
    {
      key: 'code',
      header: 'رمز القسيمة',
      lead: true,
      cell: (v) => (
        <>
          <bdi className="sx-n sx-no" dir="ltr">
            {v.code}
          </bdi>
          <span className="sx-subline">{KIND_TEXT[v.kind] ?? v.kind}</span>
        </>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (v) => (
        <span className="sx-n sx-mute">
          {dayText(isoDay(Date.parse(v.createdAt), me.tenant.timezone), digits)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'قيمتها',
      numeric: true,
      cell: (v) => <Amt minor={v.amountMinor} currency={v.currency} />,
    },
    {
      key: 'used',
      header: 'المصروف',
      numeric: true,
      cell: (v) => <Amt minor={v.redeemedMinor} currency={v.currency} zero="dash" />,
    },
    {
      key: 'left',
      header: 'الباقي',
      numeric: true,
      strong: true,
      cell: (v) =>
        v.remainingMinor > 0 ? (
          <Amt minor={v.remainingMinor} currency={v.currency} />
        ) : (
          <StatusPill kind="ok">مصروفة</StatusPill>
        ),
    },
  ];

  return (
    <>
      <Panel title="ما على المتجر من قسائم" aside="ما لم يُصرف بعد، ويُحسب التزاماً على المتجر">
        {data ? (
          data.outstanding.length === 0 ? (
            <p className="sx-wait">لا قسائم مفتوحة.</p>
          ) : (
            <dl className="cx-plan">
              {data.outstanding.map((o) => (
                <div key={o.currency}>
                  <dt>
                    <bdi className="sx-n">{o.count}</bdi> قسيمة مفتوحة
                  </dt>
                  <dd>
                    <Amt minor={o.amountMinor} currency={o.currency} />
                  </dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          <p className="sx-wait">نحمّل…</p>
        )}
      </Panel>
      <div className="sx-chips">
        <CheckChip label="أعرض المصروفة أيضاً" checked={all} onChange={setAll} />
      </div>
      <div ref={topRef} />
      <SxTable
        caption="القسائم"
        columns={columns}
        rows={items}
        rowKey={(v) => v.code}
        loading={loading}
        {...(error ? { error, onRetry: retry } : {})}
        empty={
          <Empty icon={<GiftIcon size={24} />} title={all ? 'لم تُصدَر قسائم بعد.' : 'لا قسائم مفتوحة.'}>
            <p>تصدر قسيمة الاستبدال من مرتجع على قسيمة، وقسيمة الهدية تُباع من شاشة البيع.</p>
          </Empty>
        }
      />
      <Pager noun="القسائم" pager={pager} />
    </>
  );
}
