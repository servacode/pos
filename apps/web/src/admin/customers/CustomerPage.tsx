import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CUSTOMER_KIND_LABELS,
  type CurrencyCode,
  type CustomerDetail,
  type CustomerPurchases,
  type StatementLine,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  ArchiveIcon,
  BookIcon,
  Button,
  CashIcon,
  Dialog,
  EditIcon,
  formatQuantity,
  SalesIcon,
  Skeleton,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText, isoDay } from '../../lib/dates';
import { storeSells } from '../../lib/sectors';
import { useIsPhone } from '../../lib/useIsPhone';
import { pieces } from '../../lib/plural';
import { Paged } from '../pager';
import { Amt, ChevRight, PageTop, Panel, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { WarrantyDevices } from '../warranty/WarrantyDevices';
import { statementWhat } from '../ledger/csv';
import { CustomerPlans } from '../installments/CustomerPlans';
import { archiveDuplicate, getCustomer, getPurchases, listCustomers, updateCustomer } from './api';
import { CustomerForm } from './CustomerForm';
import { CustomerMoneyDialog } from './CustomerMoneyDialog';
import { debtReminderLink } from './debtReminder';
import { Empty } from './parts';
import './customers.css';

const SOURCE_TEXT: Record<string, string> = {
  sale: 'فاتورة آجل',
  return: 'مرتجع',
  receipt: 'دفعة',
  manual: 'قيد تصحيح',
};

type StatementRow = StatementLine & { k: number };

const statementTitle = (l: StatementLine) =>
  l.sourceType === 'manual'
    ? l.memo
    : l.sourceType === 'cheque'
      ? statementWhat(l)
      : (SOURCE_TEXT[l.sourceType] ?? l.memo);

/**
 * A document number («INV-001-002-0000419») that may break only before its last part, so a narrow
 * column shows «INV-001-002-» over «0000419» instead of three broken pieces.
 */
function DocNumber({ value }: { value: string }) {
  const cut = value.lastIndexOf('-') + 1;
  return (
    <bdi dir="ltr" className="sx-n">
      <span className="whitespace-nowrap">{value.slice(0, cut)}</span>
      <wbr />
      <span className="whitespace-nowrap">{value.slice(cut)}</span>
    </bdi>
  );
}

/** The pieces of an invoice: each line with its quantity, and what came back of it. */
function InvoiceLines({ lines }: { lines: CustomerPurchases['invoices'][number]['lines'] }) {
  return (
    <ul className="cx-inv">
      {lines.map((l, index) => (
        <li key={index}>
          <span>{l.name}</span>
          <span className="sx-n sx-mute">×{l.qty / 1000}</span>
          {l.returnedQty > 0 ? (
            <StatusPill kind="warn">
              رجع <bdi className="sx-n">{l.returnedQty / 1000}</bdi>
            </StatusPill>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the customer owes (or is owed) as the figure of the page, with how much of the credit limit
 * that is and the loyalty points they hold.
 */
function BalanceHero({ customer, currency }: { customer: CustomerDetail; currency: CurrencyCode }) {
  const balance = customer.balanceMinor;
  const limit = customer.creditLimitMinor;
  const owed = Math.max(0, balance);
  const over = limit !== null && balance > limit;
  // What is still open under the limit counts a credit the customer holds too
  const room = limit === null ? null : limit - balance;
  const share = limit !== null && limit > 0 ? Math.min(100, Math.round((owed / limit) * 100)) : 0;
  return (
    <section className="sx-card cx-hero" aria-label="رصيد الزبون">
      <div className="lbl">
        <span>{balance >= 0 ? 'عليه' : 'له عند المتجر'}</span>
        {over ? <StatusPill kind="danger">فوق حد الدين</StatusPill> : null}
      </div>
      <p className={`big m-0 sx-n ${balance < 0 ? 'cred' : over ? 'over' : balance > 0 ? 'owe' : ''}`}>
        <Amt minor={Math.abs(balance)} currency={currency} />
      </p>
      <dl className="m-0">
        <div className="cx-line">
          <dt>حد الدين</dt>
          <dd>{limit === null ? 'بلا حد' : <Amt minor={limit} currency={currency} />}</dd>
        </div>
        {customer.loyaltyPoints ? (
          <div className="cx-line">
            <dt>نقاط الولاء</dt>
            <dd>
              <bdi className="sx-n">{customer.loyaltyPoints}</bdi> نقطة
            </dd>
          </div>
        ) : null}
      </dl>
      {limit !== null && limit > 0 ? (
        <>
          <div
            className={`cx-meter ${over ? 'bad' : owed >= limit * 0.8 ? 'warn' : ''}`}
            role="progressbar"
            aria-label="ما استُخدم من حد الدين"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={share}
          >
            <i style={{ width: `${share}%` }} />
          </div>
          <p className="sx-wait m-0">
            {over ? (
              <>
                تجاوز الحد بـ <Amt minor={balance - limit} currency={currency} />
              </>
            ) : (
              <>
                يبقى <Amt minor={room ?? 0} currency={currency} /> قبل الحد
              </>
            )}
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * «مشترياته»: what the customer bought in all, the sizes they buy most (the most first, so the
 * till can advise «ريم تلبس M») and the day of their latest purchase.
 */
function SizesPanel({ purchases, currency }: { purchases: CustomerPurchases; currency: CurrencyCode }) {
  const digits = useDigits();
  const me = useMe();
  const latest = purchases.invoices[0];
  const clothing = storeSells(me.tenant.sectors, ['clothing']);
  return (
    <Panel
      title="مشترياته"
      aside={
        <>
          اشترى <bdi className="sx-n">{formatQuantity(purchases.pieces, digits)}</bdi>{' '}
          {pieces(purchases.pieces / 1000)} بعد المرتجعات
        </>
      }
    >
      <p className="m-0 mb-3 font-semibold">
        <Amt minor={purchases.spentMinor} currency={currency} />
      </p>
      {purchases.sizes.length === 0 ? (
        clothing ? (
          <p className="sx-wait">لا مقاسات في مشترياته بعد.</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-3">
          {purchases.sizes.map((s) => (
            <div key={s.name} className="flex flex-col gap-2">
              <p className="sx-eyebrow m-0">{s.name}</p>
              <ul className="cx-sizes">
                {s.values.map((v, index) => (
                  <li key={v.value} className={index === 0 ? 'top' : undefined}>
                    <bdi className="font-semibold">{v.value}</bdi>
                    <span className="sx-n text-xs">×{v.qty / 1000}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <dl className="m-0 mt-3 border-t border-line pt-2">
        <div className="cx-line">
          <dt>آخر شراء</dt>
          <dd>{latest ? <bdi className="sx-n">{dayText(latest.date, digits)}</bdi> : '—'}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/** The page's shape while the customer loads. */
function LoadingCustomer() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-12 w-64" />
      <div className="cx-head">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

/** One customer (12 › كشف حساب زبون): what they owe, every sale on credit and every payment. */
export function CustomerPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const canManage = me.user.permissions.includes('customers.manage');
  const seesInvoices = me.user.permissions.includes('report.view');
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [money, setMoney] = useState<'payment' | 'opening' | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [allInvoices, setAllInvoices] = useState(false);
  const canReceive = me.user.permissions.includes('receipt.create');
  const canOpen = me.user.permissions.includes('accounting.post');

  const [purchases, setPurchases] = useState<CustomerPurchases | null>(null);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);

  // Going from one customer to another never shows the answer of the earlier one
  useEffect(() => {
    let alive = true;
    setError(null);
    setCustomer((was) => (was && was.id === id ? was : null));
    setPurchases((was) => (was && was.customerId === id ? was : null));
    getCustomer(id)
      .then((c) => alive && setCustomer(c))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    getPurchases(id)
      .then((p) => alive && setPurchases(p))
      .catch(() => alive && setPurchases(null));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  /** «أرشفه» and «أرجعه»: the server refuses to archive a customer with an open balance, cheque or points */
  async function archive(archived: boolean) {
    if (!customer) return;
    setArchiveError(null);
    try {
      setCustomer(await updateCustomer(customer.id, { name: customer.name, archived }));
      setConfirmArchive(false);
    } catch (e) {
      setArchiveError(errorMessage(e));
    }
  }

  // «أرشف هذا الزبون المكرر» is offered only when another customer has the same name or phone
  const [hasTwin, setHasTwin] = useState(false);
  const twinKey = customer ? `${customer.id}|${customer.name}|${customer.phone ?? ''}` : '';
  useEffect(() => {
    if (!customer) return;
    let alive = true;
    const name = customer.name.trim();
    const phoneNumber = customer.phone;
    void listCustomers(name)
      .then((res) => {
        if (!alive) return;
        setHasTwin(
          res.items.some(
            (c) =>
              c.id !== customer.id &&
              !c.archived &&
              (c.name.trim() === name || (phoneNumber !== null && c.phone === phoneNumber)),
          ),
        );
      })
      .catch(() => alive && setHasTwin(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- twinKey stands for the three fields it joins
  }, [twinKey]);

  /** «أرشف هذا الزبون المكرر»: refused with its reason when money or a cheque is still open on them */
  async function archiveAsDuplicate() {
    if (!customer) return;
    try {
      setCustomer(await archiveDuplicate(customer.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const base = customer?.baseCurrency ?? 'SYP';
  const reminder =
    customer && !customer.noMessages
      ? debtReminderLink(customer.phone, {
          name: customer.name,
          balanceMinor: customer.balanceMinor,
          currency: base,
          store: me.tenant.name,
        })
      : null;

  const columns: SxColumn<StatementRow>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      cell: (l) => <span className="sx-n sx-mute">{dayText(l.date, digits)}</span>,
    },
    {
      key: 'what',
      header: 'البيان',
      lead: true,
      cell: (l) => (
        <>
          <span>{statementTitle(l)}</span>
          {l.number ? (
            <span className="sx-subline">
              <DocNumber value={l.number} />
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'debit',
      header: 'عليه',
      numeric: true,
      cell: (l) => (l.debitMinor ? <Amt minor={l.debitMinor} currency={base} /> : ''),
    },
    {
      key: 'credit',
      header: 'له',
      numeric: true,
      cell: (l) => (l.creditMinor ? <Amt minor={l.creditMinor} currency={base} /> : ''),
    },
    {
      key: 'balance',
      header: 'الرصيد',
      numeric: true,
      strong: true,
      cell: (l) => <Amt minor={l.balanceMinor} currency={base} />,
    },
  ];

  const statementEmpty = (
    <Empty icon={<BookIcon size={24} />} title="لا حركة على حساب هذا الزبون بعد.">
      <p>يظهر هنا كل بيع بالآجل له، وكل دفعة يدفعها.</p>
    </Empty>
  );
  // The newest line first: the running balance is after each line, and the latest page is the one wanted
  const statement: StatementRow[] = (customer?.statement ?? []).map((l, k) => ({ ...l, k })).reverse();

  const invoices = purchases?.invoices ?? [];
  const shownInvoices = allInvoices ? invoices : invoices.slice(0, 5);

  return (
    <AppShell>
      <title>{`${customer?.name ?? 'زبون'} · SERVA`}</title>
      <SalesPage>
        <Link to="/customers" className="sx-back print:hidden">
          <ChevRight /> الزبائن
        </Link>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!customer && !error ? <LoadingCustomer /> : null}
        {customer ? (
          <>
            <PageTop
              title={customer.name}
              subtitle={
                <>
                  زبون منذ{' '}
                  <bdi className="sx-n">
                    {dayText(isoDay(Date.parse(customer.createdAt), me.tenant.timezone), digits)}
                  </bdi>
                </>
              }
              actions={
                <>
                  {seesInvoices ? (
                    <Link
                      to={`/sales/invoices?customerId=${encodeURIComponent(customer.id)}`}
                      className="sx-fbtn"
                    >
                      <SalesIcon size={16} /> فواتير الزبون
                    </Link>
                  ) : null}
                  {reminder ? (
                    <a href={reminder} target="_blank" rel="noreferrer" className="sx-fbtn">
                      <CashIcon size={16} /> ذكّره بالدين
                    </a>
                  ) : null}
                  {canManage && !editing ? (
                    <>
                      <Button variant="secondary" icon={<EditIcon />} onClick={() => setEditing(true)}>
                        عدّل
                      </Button>
                      <Button
                        variant="ghost"
                        icon={customer.archived ? <UndoIcon /> : <ArchiveIcon />}
                        onClick={() => {
                          setArchiveError(null);
                          if (customer.archived) void archive(false);
                          else setConfirmArchive(true);
                        }}
                      >
                        {customer.archived ? 'أرجعه' : 'أرشفه'}
                      </Button>
                      {customer.archived || !hasTwin ? null : (
                        <Button
                          variant="ghost"
                          icon={<ArchiveIcon />}
                          onClick={() => void archiveAsDuplicate()}
                        >
                          أرشف هذا الزبون المكرر
                        </Button>
                      )}
                    </>
                  ) : null}
                </>
              }
            />
            <div className="cx-badges">
              {customer.priceTier === 'wholesale' ? <StatusPill kind="ok">زبون جملة</StatusPill> : null}
              {customer.archived ? <StatusPill kind="open">مؤرشف</StatusPill> : null}
              {customer.noMessages ? <StatusPill kind="open">لا يريد رسائل</StatusPill> : null}
              {customer.kind ? (
                <StatusPill kind="ok">{CUSTOMER_KIND_LABELS[customer.kind]}</StatusPill>
              ) : null}
            </div>
            {archiveError && !confirmArchive ? <Alert tone="error">{archiveError}</Alert> : null}
            {customer.archived ? (
              <Alert tone="info">هذا الزبون مؤرشف: لا يظهر على أجهزة الكاشير.</Alert>
            ) : null}
            {editing ? (
              <CustomerForm
                customer={customer}
                onSaved={(c) => {
                  setCustomer(c);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : null}
            <div className="cx-head">
              <div className="cx-main">
                <Panel title="بيانات الزبون">
                  <dl className="cx-facts">
                    <div>
                      <dt>الجوال</dt>
                      <dd>
                        {customer.phone ? (
                          <bdi dir="ltr" className="sx-n">
                            {customer.phone}
                          </bdi>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>العنوان</dt>
                      <dd>{customer.address ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>الرقم الضريبي</dt>
                      <dd>{customer.taxNumber ? <bdi className="sx-n">{customer.taxNumber}</bdi> : '—'}</dd>
                    </div>
                    {customer.contactName || customer.contactPhone ? (
                      <div>
                        <dt>المسؤول</dt>
                        <dd>
                          {customer.contactName ?? '—'}
                          {customer.contactPhone ? (
                            <>
                              {' · '}
                              <bdi dir="ltr" className="sx-n">
                                {customer.contactPhone}
                              </bdi>
                            </>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {customer.notes ? (
                    <p className="cx-notes">
                      <span className="font-semibold text-ink">ملاحظات: </span>
                      {customer.notes}
                    </p>
                  ) : null}
                </Panel>
                <Panel
                  title="كشف الحساب"
                  aside={
                    <>
                      {canReceive ? (
                        <Button icon={<AddIcon />} onClick={() => setMoney('payment')}>
                          استلم دفعة
                        </Button>
                      ) : null}
                      {canOpen && !customer.archived ? (
                        <Button variant="secondary" onClick={() => setMoney('opening')}>
                          سجّل دين افتتاحي
                        </Button>
                      ) : null}
                      <Link to={`/customers/${customer.id}/statement`} className="sx-fbtn">
                        <BookIcon size={16} /> كشف حساب بفترة، للطباعة
                      </Link>
                    </>
                  }
                  flush
                >
                  {phone && statement.length > 0 ? (
                    <Paged
                      rows={statement}
                      size={15}
                      noun="الحركات"
                      render={(page) => (
                        <ul className="cx-stm" aria-label="كشف الحساب">
                          {page.map((l) => (
                            <li key={l.k}>
                              <span className="what">{statementTitle(l)}</span>
                              <span className="num end font-semibold">
                                {l.debitMinor ? (
                                  <>
                                    <span className="sx-sub text-xs">عليه </span>
                                    <Amt minor={l.debitMinor} currency={base} />
                                  </>
                                ) : (
                                  <span className="cx-ok">
                                    <span className="text-xs">له </span>
                                    <Amt minor={l.creditMinor} currency={base} />
                                  </span>
                                )}
                              </span>
                              <span className="row2">
                                <span className="num">
                                  {l.number ? (
                                    <>
                                      <DocNumber value={l.number} /> ·{' '}
                                    </>
                                  ) : null}
                                  {dayText(l.date, digits)}
                                </span>
                                <span className="num">
                                  الرصيد <Amt minor={l.balanceMinor} currency={base} />
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    />
                  ) : (
                    <Paged
                      rows={statement}
                      size={25}
                      noun="الحركات"
                      render={(page) => (
                        <SxTable
                          bare
                          caption="كشف الحساب"
                          columns={columns}
                          rows={page}
                          rowKey={(l) => String(l.k)}
                          empty={statementEmpty}
                        />
                      )}
                    />
                  )}
                </Panel>
                {purchases ? (
                  <Panel title="آخر الفواتير" aside="أحدث ما اشتراه، قطعة قطعة، وما رجع منه." flush>
                    {shownInvoices.length === 0 ? (
                      <Empty icon={<SalesIcon size={24} />} title="لم يشترِ شيئاً بعد." />
                    ) : (
                      <ul className="cx-stm" aria-label="آخر الفواتير">
                        {shownInvoices.map((r) => (
                          <li key={r.id}>
                            <span className="what">
                              <DocNumber value={r.number} />
                            </span>
                            <span className="num end font-semibold">
                              <Amt minor={r.totalMinor} currency={r.currency} />
                            </span>
                            <span className="row2">
                              <span className="num">{dayText(r.date, digits)}</span>
                            </span>
                            <span style={{ gridColumn: '1 / -1' }}>
                              <InvoiceLines lines={r.lines} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {invoices.length > 5 ? (
                      <div className="cx-more">
                        <Button variant="secondary" onClick={() => setAllInvoices((v) => !v)}>
                          {allInvoices ? 'اعرض أحدث 5 فقط' : `اعرض الكل (${invoices.length})`}
                        </Button>
                      </div>
                    ) : null}
                  </Panel>
                ) : null}
                <CustomerPlans customerId={customer.id} />
                {storeSells(me.tenant.sectors, ['electronics', 'medical_supplies']) ? (
                  <WarrantyDevices
                    by={{ customerId: customer.id }}
                    storeName={me.tenant.name}
                    customerName={customer.name}
                    customerPhone={customer.phone}
                    heading="أجهزته وكفالتها"
                  />
                ) : null}
              </div>
              <aside className="cx-side">
                <BalanceHero customer={customer} currency={base} />
                {purchases ? <SizesPanel purchases={purchases} currency={base} /> : null}
              </aside>
            </div>
            {canReceive && phone ? (
              <div className="cx-dock print:hidden">
                <Button icon={<AddIcon />} onClick={() => setMoney('payment')}>
                  استلم دفعة
                </Button>
                {reminder ? (
                  <a href={reminder} target="_blank" rel="noreferrer" className="sx-fbtn">
                    <CashIcon size={16} /> ذكّره بالدين
                  </a>
                ) : null}
              </div>
            ) : null}
            {money ? (
              <CustomerMoneyDialog
                kind={money}
                customer={customer}
                onCancel={() => setMoney(null)}
                onDone={() => {
                  setMoney(null);
                  load();
                }}
              />
            ) : null}
            {confirmArchive ? (
              <Dialog
                open
                onOpenChange={(open) => {
                  if (!open) setConfirmArchive(false);
                }}
                title={`أرشفة ${customer.name}؟`}
                description="لا يظهر بعدها على أجهزة الكاشير ولا في القوائم، وتبقى فواتيره وحسابه في الدفاتر. تقدر تعيده متى شئت."
              >
                <div className="flex flex-col gap-4">
                  {customer.balanceMinor !== 0 ? (
                    <Alert tone="warning">
                      {customer.balanceMinor > 0 ? 'عليه دين: ' : 'له رصيد عندنا: '}
                      <Amt minor={Math.abs(customer.balanceMinor)} currency={base} />. لا يُؤرشف زبون حسابه
                      مفتوح؛ سدّد حسابه أولاً.
                    </Alert>
                  ) : null}
                  {archiveError ? <Alert tone="error">{archiveError}</Alert> : null}
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
                      تراجع
                    </Button>
                    <Button onClick={() => void archive(true)}>نعم، أرشفه</Button>
                  </div>
                </div>
              </Dialog>
            ) : null}
          </>
        ) : null}
      </SalesPage>
    </AppShell>
  );
}
