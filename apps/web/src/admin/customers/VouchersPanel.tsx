import { useEffect, useState } from 'react';
import type { VoucherListRow } from '@serva/core';
import { Alert, Button, Dialog, GiftIcon, SearchField, TextField, useDigits } from '@serva/ui';
import { DateField } from '../../lib/DateField';
import { useMe } from '../../auth/useAuth';
import { useIsPhone } from '../../lib/useIsPhone';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay } from '../../lib/dates';
import { Pager, useCursorPages } from '../pager';
import { Amt, Panel, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { listVouchers, updateVoucher } from './api';
import { CheckChip, Empty, RadioChips } from './parts';

const KIND_TEXT: Record<string, string> = { exchange: 'قسيمة استبدال', gift: 'قسيمة هدية', deposit: 'عربون' };
const KIND_FILTER = [
  { value: '', label: 'كل الأنواع' },
  { value: 'exchange', label: 'استبدال' },
  { value: 'gift', label: 'هدية' },
  { value: 'deposit', label: 'عربون' },
] as const;

/** The state of a voucher in words: never colour alone */
function StatePill({ v }: { v: VoucherListRow }) {
  if (v.state === 'void') return <StatusPill kind="danger">ملغاة</StatusPill>;
  if (v.state === 'expired') return <StatusPill kind="warn">منتهية</StatusPill>;
  if (v.remainingMinor <= 0) return <StatusPill kind="ok">مصروفة</StatusPill>;
  return null;
}

/** The last day of a voucher, or cancel it: what was left stops being owed on 2310 and goes to other income */
function ManageDialog({
  voucher,
  onClose,
  onDone,
}: {
  voucher: VoucherListRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [expires, setExpires] = useState(voucher.expiresOn ?? '');
  const [reason, setReason] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(input: Parameters<typeof updateVoucher>[1]) {
    setSaving(true);
    setError(null);
    try {
      await updateVoucher(voucher.code, input);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`القسيمة ${voucher.code}`}
      description="حدّد آخر يوم تُقبل فيه، أو ألغِها."
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <DateField label="آخر يوم تُقبل فيه" value={expires} onChange={setExpires} />
        {confirmVoid ? (
          <>
            <Alert tone="warning">
              تُلغى القسيمة ويُحوَّل ما بقي عليها (
              <Amt minor={voucher.remainingMinor} currency={voucher.currency} />) من التزامات المتجر إلى
              إيرادات أخرى. لا يمكن التراجع.
            </Alert>
            <TextField
              label="السبب"
              hint="اختياري"
              value={reason}
              maxLength={120}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmVoid(false)}>
                تراجع
              </Button>
              <Button
                loading={saving}
                onClick={() => void run({ void: true, reason: reason.trim() || null })}
              >
                نعم، ألغِ القسيمة
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setConfirmVoid(true)}>
              ألغِ القسيمة
            </Button>
            <span className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>
                إغلاق
              </Button>
              <Button loading={saving} onClick={() => void run({ expiresOn: expires || null })}>
                احفظ التاريخ
              </Button>
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * «القسائم»: the exchange, gift and deposit vouchers the store has issued and what is left on each,
 * which is what the store still owes (the 2310 account). The till issues and takes them; the owner
 * sets a last day or cancels one here.
 */
export function VouchersPanel() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const canManage = me.user.permissions.includes('customers.manage');
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [managing, setManaging] = useState<VoucherListRow | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const status = all ? 'all' : 'open';
  const { data, error, loading, retry, pager, topRef } = useCursorPages(`${status}|${kind}|${q}`, (cursor) =>
    listVouchers(status, cursor, { kind, q }),
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
          <span className="sx-subline">
            <StatusPill kind="ok">{KIND_TEXT[v.kind] ?? v.kind}</StatusPill>
          </span>
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
      key: 'expires',
      header: 'تنتهي',
      hideBelowLg: true,
      cell: (v) =>
        v.expiresOn ? (
          <span className="sx-n sx-mute">{dayText(v.expiresOn, digits)}</span>
        ) : (
          <span className="sx-z">—</span>
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
        v.remainingMinor > 0 ? <Amt minor={v.remainingMinor} currency={v.currency} /> : <StatePill v={v} />,
    },
    ...(canManage
      ? [
          {
            key: 'manage',
            header: <span className="sr-only">إدارة</span>,
            cell: (v: VoucherListRow) =>
              v.state === 'open' || v.state === 'expired' ? (
                <Button variant="ghost" size="sm" onClick={() => setManaging(v)}>
                  إدارة
                </Button>
              ) : null,
          } satisfies SxColumn<VoucherListRow>,
        ]
      : []),
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
      <div className="sx-card sx-filterbar">
        <div className="sx-search">
          <SearchField
            label="ابحث برمز القسيمة"
            value={typed}
            onValueChange={(v) => setTyped(v.slice(0, 40))}
          />
        </div>
        <RadioChips
          name="voucher-kind"
          label="نوع القسيمة"
          value={kind}
          options={KIND_FILTER}
          onChange={setKind}
        />
        <div className="sx-chips">
          <CheckChip label="أعرض المصروفة والمنتهية" checked={all} onChange={setAll} />
        </div>
      </div>
      <div ref={topRef} />
      {phone && !loading && !error && items.length > 0 ? (
        <ul className="sx-cards" aria-label="القسائم">
          {items.map((v) => (
            <li key={v.code} className="sx-scard">
              <span className="cx-who">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <bdi className="sx-n nm" dir="ltr">
                    {v.code}
                  </bdi>
                  <span className="cx-badges">
                    <StatusPill kind="ok">{KIND_TEXT[v.kind] ?? v.kind}</StatusPill>
                    <StatePill v={v} />
                  </span>
                </span>
              </span>
              <span className="justify-self-end text-end">
                {v.remainingMinor > 0 ? (
                  <Amt minor={v.remainingMinor} currency={v.currency} />
                ) : (
                  <span className="sx-z">—</span>
                )}
              </span>
              <span className="x">
                <span>{v.expiresOn ? `تنتهي ${dayText(v.expiresOn, digits)}` : 'بلا تاريخ انتهاء'}</span>
                {canManage && (v.state === 'open' || v.state === 'expired') ? (
                  <Button variant="ghost" size="sm" onClick={() => setManaging(v)}>
                    إدارة
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <SxTable
          caption="القسائم"
          columns={columns}
          rows={items}
          rowKey={(v) => v.code}
          loading={loading}
          {...(error ? { error, onRetry: retry } : {})}
          empty={
            <Empty
              icon={<GiftIcon size={24} />}
              title={all || q ? 'لا قسائم بهذا الوصف.' : 'لا قسائم مفتوحة.'}
            >
              <p>تصدر قسيمة الاستبدال من مرتجع على قسيمة، وقسيمة الهدية تُباع من شاشة البيع.</p>
            </Empty>
          }
        />
      )}
      <Pager noun="القسائم" pager={pager} />
      {managing ? (
        <ManageDialog
          voucher={managing}
          onClose={() => setManaging(null)}
          onDone={() => {
            setManaging(null);
            retry();
          }}
        />
      ) : null}
    </>
  );
}
