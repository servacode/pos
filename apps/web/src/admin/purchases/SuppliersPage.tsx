import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { contactPhoneSchema, type SupplierListResponse, type SupplierRow } from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  Dialog,
  EmptyState,
  SearchField,
  Switch,
  TextField,
  ToggleChip,
  TruckIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { downloadCsv } from '../exportCsv';
import { ReportScreen } from '../reports/parts';
import { Amt, DownloadGlyph, PageTop, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { listSuppliers, newDocumentId, openSupplierBalance, storeToday, updateSupplier } from './api';
import {
  OpeningBalanceFields,
  emptyOpening,
  openingInput,
  openingRateOk,
  type OpeningState,
} from './OpeningBalanceFields';
import { SupplierForm } from './PurchasesPage';
import './purchases.css';

/**
 * «الموردون»: every supplier with what the store owes them (in pounds and, apart, in dollars), each linked to
 * their statement, and editable: the name, the phone, the notes, and the archive switch (round 44). New
 * suppliers and invoices stay on «المشتريات».
 */
export function SuppliersPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [list, setList] = useState<SupplierListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [owed, setOwed] = useState(false);
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Only the newest answer is kept: a slow earlier read never overwrites a later one
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    setError(null);
    listSuppliers().then(
      (r) => mine === latest.current && setList(r),
      (e: unknown) => mine === latest.current && setError(errorMessage(e)),
    );
  }, []);
  useEffect(load, [load]);

  const base = list?.baseCurrency ?? me.settings.baseCurrency;
  const needle = search.trim().toLowerCase();
  const items = useMemo(
    () =>
      (list?.items ?? []).filter(
        (s) =>
          (archived || !s.archived) &&
          (!needle || s.name.toLowerCase().includes(needle) || (s.phone ?? '').includes(needle)) &&
          (!owed || s.balanceMinor > 0 || (s.usdBalanceMinor ?? 0) > 0),
      ),
    [list, needle, owed, archived],
  );
  const owedUsd = (list?.items ?? []).reduce((sum, s) => sum + Math.max(0, s.usdBalanceMinor ?? 0), 0);
  const creditors = (list?.items ?? []).filter((s) => s.balanceMinor > 0).length;
  const hiddenCount = (list?.items ?? []).filter((s) => s.archived).length;

  /** What is owed to a supplier: pounds, with the dollars apart under it when some of the debt is in dollars */
  const owedCell = (s: SupplierRow) => (
    <span className="px-dual">
      {s.balanceMinor === 0 && !s.usdBalanceMinor ? (
        <span className="sx-sub">لا مستحقات</span>
      ) : (
        <Amt minor={s.balanceMinor} currency={base} zero="dash" />
      )}
      {s.usdBalanceMinor ? (
        <span className="usd">
          {s.usdBalanceMinor > 0 ? 'منه ' : 'دفعة مقدّمة '}
          <Amt minor={Math.abs(s.usdBalanceMinor)} currency="USD" />
        </span>
      ) : null}
    </span>
  );

  const columns: SxColumn<SupplierRow>[] = [
    {
      key: 'name',
      header: 'المورد',
      lead: true,
      cell: (s) => (
        <>
          <Link to={`/suppliers/${s.id}/statement`} className="sx-rowbtn">
            {s.name}
          </Link>
          {s.archived ? (
            <>
              {' '}
              <StatusPill kind="warn">مؤرشف</StatusPill>
            </>
          ) : null}
          {s.phone ? (
            <span className="sx-subline">
              <bdi dir="ltr" className="sx-n">
                {s.phone}
              </bdi>
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'last',
      header: 'آخر شراء',
      hideBelowLg: true,
      cell: (s) =>
        s.lastPurchaseOn ? (
          <span className="sx-mute">{dayText(s.lastPurchaseOn, digits)}</span>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    {
      key: 'total',
      header: 'مشترياتنا منه',
      numeric: true,
      hideBelowLg: true,
      cell: (s) =>
        s.purchasesTotalMinor ? (
          <span className="sx-mute">
            <Amt minor={s.purchasesTotalMinor} currency={base} />
          </span>
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    {
      key: 'balance',
      header: 'المستحق للمورد',
      numeric: true,
      strong: true,
      cell: owedCell,
    },
    {
      key: 'actions',
      header: <span className="sr-only">إجراءات</span>,
      cell: (s) => (
        <span className="px-actions">
          {s.balanceMinor > 0 || (s.usdBalanceMinor ?? 0) > 0 ? (
            <Button variant="ghost" size="xs" onClick={() => void navigate(`/purchases?pay=${s.id}`)}>
              دفعة
            </Button>
          ) : null}
          <Button variant="ghost" size="xs" aria-label={`عدّل ${s.name}`} onClick={() => setEditing(s)}>
            عدّل
          </Button>
          <Link to={`/suppliers/${s.id}/statement`} className="sx-linkbtn">
            كشف الحساب
          </Link>
        </span>
      ),
    },
  ];

  const filtered = needle !== '' || owed;
  return (
    <ReportScreen me={me} access={['purchases.manage']} title="الموردون">
      <SalesPage>
        <PageTop
          title="الموردون"
          subtitle="من تشتري منهم، وكم لهم عليك. لتسجيل فاتورة أو دفعة افتح «المشتريات»."
          actions={
            <>
              <Button
                variant="ghost"
                icon={<DownloadGlyph size={20} />}
                disabled={!list?.items.length}
                onClick={() => exportSuppliers(list?.items ?? [], storeToday(me.tenant.timezone))}
              >
                صدّر إلى إكسل
              </Button>
              <Button icon={<AddIcon />} onClick={() => setAdding(true)}>
                مورد جديد
              </Button>
            </>
          }
        />
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <section aria-label="ما عليك للموردين" className="sx-card sx-strip px-strip">
          <div>
            <span className="sx-eyebrow">المستحق للموردين</span>
            <span className="v big">{list ? <Amt minor={list.totalOwedMinor} currency={base} /> : '…'}</span>
            <span className="note">
              {list ? (
                <>
                  <span className="sx-n">{creditors.toLocaleString('en-US')}</span> مورد له مبلغ عليك
                </>
              ) : null}
            </span>
          </div>
          <div>
            <span className="sx-eyebrow">منه بالدولار</span>
            <span className="v">{list ? <Amt minor={owedUsd} currency="USD" zero="dash" /> : '…'}</span>
            <span className="note">يُدفع بالدولار</span>
          </div>
          <div>
            <span className="sx-eyebrow">كل الموردين</span>
            <span className="v sx-n">{list ? list.items.length.toLocaleString('en-US') : '…'}</span>
            <span className="note">
              {hiddenCount > 0 ? (
                <>
                  منهم <span className="sx-n">{hiddenCount.toLocaleString('en-US')}</span> مؤرشف
                </>
              ) : null}
            </span>
          </div>
        </section>
        <div className="sx-card sx-filterbar print:hidden">
          <div className="sx-search">
            <SearchField label="ابحث بالاسم أو الجوال" value={search} onValueChange={setSearch} />
          </div>
          <ToggleChip label="من له مبلغ فقط" checked={owed} onChange={(e) => setOwed(e.target.checked)} />
          {hiddenCount > 0 ? (
            <ToggleChip
              label="أظهر المؤرشفين"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
          ) : null}
        </div>
        {phone && items.length > 0 ? (
          <ul className="sx-cards" aria-label="الموردون وأرصدتهم">
            {items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="sx-icard"
                  aria-label={`كشف حساب ${s.name}`}
                  onClick={() => void navigate(`/suppliers/${s.id}/statement`)}
                >
                  <span className="px-owe-name">{s.name}</span>
                  <span className="t">{owedCell(s)}</span>
                  <span className="d">
                    {s.archived ? 'مؤرشف · ' : ''}
                    {s.phone ? (
                      <bdi dir="ltr" className="sx-n">
                        {s.phone}
                      </bdi>
                    ) : (
                      'بلا جوال'
                    )}
                    {s.lastPurchaseOn ? <> · آخر شراء {dayText(s.lastPurchaseOn, digits)}</> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <SxTable
            caption="الموردون وأرصدتهم"
            columns={columns}
            rows={items}
            rowKey={(s) => s.id}
            loading={!list && !error}
            error={error ?? undefined}
            onRetry={load}
            onRowClick={(s) => void navigate(`/suppliers/${s.id}/statement`)}
            empty={
              <EmptyState
                icon={TruckIcon}
                title={filtered ? 'لا موردين بهذا البحث.' : 'لا موردين بعد.'}
                description={
                  filtered ? 'غيّر البحث أو امسحه.' : 'أضف مورداً أولاً، ثم سجّل فواتير الشراء منه.'
                }
                action={
                  filtered ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setOwed(false);
                      }}
                    >
                      امسح البحث
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
        {adding ? (
          <SupplierForm
            suppliers={list?.items ?? []}
            onSaved={() => {
              setAdding(false);
              setNotice('أُضيف المورد.');
              load();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {editing ? (
          <SupplierEditDialog
            supplier={editing}
            others={(list?.items ?? []).filter((x) => x.id !== editing.id)}
            onSaved={(saved) => {
              setEditing(null);
              setNotice(saved.archived ? `أُرشف المورد ${saved.name}.` : `حُفظت بيانات ${saved.name}.`);
              load();
            }}
            onCancel={() => setEditing(null)}
            onOpened={(name) => {
              setEditing(null);
              setNotice(`سُجّل الرصيد الافتتاحي للمورد ${name}.`);
              load();
            }}
          />
        ) : null}
      </SalesPage>
    </ReportScreen>
  );
}

/** «عدّل المورد»: the name, the phone, the notes and the archive switch (an archived supplier is hidden from the pickers) */
function SupplierEditDialog({
  supplier,
  others,
  onSaved,
  onOpened,
  onCancel,
}: {
  supplier: SupplierRow;
  others: SupplierRow[];
  onSaved: (saved: SupplierRow) => void;
  onOpened: (supplierName: string) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  // «رصيد افتتاحي»: its own button and its own id, so a retry never posts it twice
  const [opening, setOpening] = useState<OpeningState>(emptyOpening);
  const [openingId] = useState(newDocumentId);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [openingFields, setOpeningFields] = useState<Record<string, string>>({});
  const openingBody = openingInput(opening, openingId);
  async function recordOpening() {
    if (!openingBody || !openingRateOk(opening)) return;
    setOpeningBusy(true);
    setOpeningError(null);
    setOpeningFields({});
    try {
      await openSupplierBalance(supplier.id, openingBody);
      onOpened(supplier.name);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setOpeningFields(e.fields);
      setOpeningError(errorMessage(e));
      setOpeningBusy(false);
    }
  }
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [notes, setNotes] = useState(supplier.notes ?? '');
  const [archived, setArchived] = useState(supplier.archived);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const same = others.find((o) => o.name.trim() === name.trim() && name.trim() !== '');
  const owes = supplier.balanceMinor !== 0 || (supplier.usdBalanceMinor ?? 0) !== 0;

  async function save() {
    const wrong = phone.trim() ? contactPhoneSchema.safeParse(phone) : null;
    if (wrong && !wrong.success) {
      setFields({ phone: wrong.error.issues[0]?.message ?? 'رقم الهاتف غير صحيح' });
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      onSaved(
        await updateSupplier(supplier.id, {
          name: name.trim(),
          phone: phone.trim(),
          notes: notes.trim(),
          archived,
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`عدّل المورد ${supplier.name}`}
      description="الاسم والجوال يظهران في الفواتير والطلبيات ورسالة واتساب."
    >
      <form
        aria-label="عدّل المورد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === '') {
            setFields({ name: 'اكتب اسم المورد' });
            return;
          }
          void save();
        }}
      >
        {error && Object.keys(fields).length === 0 ? <Alert tone="error">{error}</Alert> : null}
        {same ? (
          <Alert tone="warning">يوجد مورد آخر بالاسم نفسه «{same.name}». تأكّد أنهما مورّدان مختلفان.</Alert>
        ) : null}
        <TextField
          label="اسم المورد"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <TextField
          label="الجوال"
          hint="اختياري"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fields.phone}
        />
        <TextField
          label="ملاحظات"
          hint="اختياري"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={fields.notes}
        />
        <Switch
          label="أرشف هذا المورد"
          description={
            owes
              ? 'عليك له مبلغ: يبقى كشف حسابه ودفعاته، لكنه يختفي من قوائم اختيار المورد.'
              : 'يختفي من قوائم اختيار المورد، ويبقى كشف حسابه.'
          }
          checked={archived}
          onCheckedChange={setArchived}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
        </div>
      </form>
      <div className="mt-4 flex flex-col gap-3">
        {openingError && Object.keys(openingFields).length === 0 ? (
          <Alert tone="error">{openingError}</Alert>
        ) : null}
        <OpeningBalanceFields
          value={opening}
          onChange={setOpening}
          base={me.settings.baseCurrency}
          errors={openingFields}
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={openingBusy}
            disabled={!openingBody || !openingRateOk(opening)}
            onClick={() => void recordOpening()}
          >
            سجّل الرصيد الافتتاحي
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The suppliers with what is owed to each as a CSV file. */
function exportSuppliers(rows: SupplierRow[], day: string) {
  downloadCsv(
    `الموردون-${day}`,
    ['المورد', 'الجوال', 'المستحق للمورد', 'منه بالدولار', 'ملاحظات'],
    rows.map((x) => [
      x.name,
      x.phone ?? '',
      x.balanceMinor / 100,
      x.usdBalanceMinor ? x.usdBalanceMinor / 100 : '',
      x.notes ?? '',
    ]),
  );
}
