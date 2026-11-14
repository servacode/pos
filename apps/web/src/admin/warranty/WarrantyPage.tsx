import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import {
  WARRANTY_NEXT,
  WARRANTY_STATUS_LABELS,
  toMinor,
  formatMoney,
  type WarrantyClaim,
  type WarrantyLookup,
  type WarrantyStatus,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  PrintIcon,
  SearchIcon,
  SegmentedControl,
  SerialIcon,
  TextField,
  type BadgeTone,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { SectionHead } from '../purchases/parts';
import { listClaims, lookupWarranty, moveClaim, openClaim } from './api';
import { DateField } from '../../lib/DateField';

const TONES: Record<WarrantyStatus, BadgeTone> = {
  received: 'info',
  sent: 'warning',
  ready: 'success',
  delivered: 'neutral',
};

/** The button of each step a claim can take next */
const STEP_LABELS: Record<Exclude<WarrantyStatus, 'received'>, string> = {
  sent: 'أُرسلت للمورد أو الصيانة',
  ready: 'صارت جاهزة',
  delivered: 'سُلّمت للزبون',
};

function fieldError(e: unknown): string {
  return e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e);
}

/** The slip a customer takes: what was left, why, and the steps so far */
function ClaimSlip({ claim }: { claim: WarrantyClaim }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block" dir="rtl">
      <style>{'@page { size: A5; margin: 12mm }'}</style>
      <h1 className="text-xl font-bold">مطالبة ضمان وصيانة</h1>
      <p className="num text-lg font-semibold">{claim.number}</p>
      <dl className="mt-4 grid gap-1 text-sm">
        <div>
          <dt className="inline font-semibold">القطعة: </dt>
          <dd className="inline">{claim.item}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">الرقم التسلسلي: </dt>
          <dd className="inline">
            <bdi dir="ltr" className="num">
              {claim.serial}
            </bdi>
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">الزبون: </dt>
          <dd className="inline">
            {claim.customerName ?? '—'}
            {claim.customerPhone ? ` · ${claim.customerPhone}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">الفاتورة: </dt>
          <dd className="inline">
            {claim.saleNumber ?? '—'} {claim.soldOn ? `· ${claim.soldOn}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">الكفالة: </dt>
          <dd className="inline">
            {claim.warrantyUntil
              ? `حتى ${claim.warrantyUntil} (${claim.underWarranty ? 'سارية عند الاستلام' : 'منتهية عند الاستلام'})`
              : 'لا كفالة'}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">العطل: </dt>
          <dd className="inline">{claim.issue}</dd>
        </div>
        {claim.sentTo ? (
          <div>
            <dt className="inline font-semibold">أُرسلت إلى: </dt>
            <dd className="inline">{claim.sentTo}</dd>
          </div>
        ) : null}
        {claim.technician ? (
          <div>
            <dt className="inline font-semibold">الفني: </dt>
            <dd className="inline">{claim.technician}</dd>
          </div>
        ) : null}
        {claim.loanItem ? (
          <div>
            <dt className="inline font-semibold">جهاز بديل مُعار: </dt>
            <dd className="inline">{claim.loanItem}</dd>
          </div>
        ) : null}
        {claim.paidRepair ? (
          <div>
            <dt className="inline font-semibold">صيانة مدفوعة: </dt>
            <dd className="inline">{claim.repairSaleNumber ?? 'تُحاسب بفاتورة بيع (بند صيانة)'}</dd>
          </div>
        ) : null}
      </dl>
      <ol className="mt-4 list-decimal ps-5 text-sm">
        {claim.events.map((event, i) => (
          <li key={i}>
            {WARRANTY_STATUS_LABELS[event.status]} · <span className="num">{event.on}</span>
            {event.note ? ` · ${event.note}` : ''}
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}

/** One step of a claim: the day, the note, and for «أُرسلت» where it went */
function StepDialog({
  claim,
  status,
  onClose,
  onDone,
}: {
  claim: WarrantyClaim;
  status: Exclude<WarrantyStatus, 'received'>;
  onClose: () => void;
  onDone: (claim: WarrantyClaim) => void;
}) {
  const [sentTo, setSentTo] = useState(claim.sentTo ?? '');
  const me = useMe();
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [technician, setTechnician] = useState(claim.technician ?? '');
  const [cost, setCost] = useState('');
  const [repairSale, setRepairSale] = useState(claim.repairSaleNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    let costMinor: number | undefined;
    try {
      costMinor = cost.trim() ? toMinor(cost, me.settings.baseCurrency) : undefined;
    } catch {
      setSaving(false);
      setError('اكتب التكلفة رقماً.');
      return;
    }
    try {
      onDone(
        await moveClaim(claim.id, {
          status,
          version: claim.version,
          ...(on ? { on } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(status === 'sent' ? { sentTo: sentTo.trim() } : {}),
          ...(technician.trim() ? { technician: technician.trim() } : {}),
          ...(costMinor !== undefined ? { costMinor } : {}),
          ...(repairSale.trim() ? { repairSaleNumber: repairSale.trim() } : {}),
        }),
      );
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${claim.number}: ${STEP_LABELS[status]}`}
      description={claim.item}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" form="warranty-step" loading={saving}>
            سجّل
          </Button>
        </>
      }
    >
      <form id="warranty-step" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {status === 'sent' ? (
          <TextField label="المورد أو الورشة" value={sentTo} onChange={(e) => setSentTo(e.target.value)} />
        ) : null}
        <DateField label="التاريخ (اتركه فارغاً لليوم)" value={on} onChange={setOn} />
        <TextField label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <TextField
          label="الفني (اختياري)"
          value={technician}
          onChange={(e) => setTechnician(e.target.value)}
        />
        <TextField
          label="تكلفة الصيانة (اختياري)"
          dir="ltr"
          inputClassName="num"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        {claim.paidRepair ? (
          <TextField
            label="رقم فاتورة الصيانة المدفوعة"
            dir="ltr"
            inputClassName="num"
            hint="بعتَ بند «صيانة» من الصندوق؟ اكتب رقم فاتورته هنا."
            value={repairSale}
            onChange={(e) => setRepairSale(e.target.value)}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * «الضمان والصيانة» (03 › الإلكترونيات والأدوات الطبية): look a piece up by its serial number or IMEI
 * to see its sale, its customer and when its warranty ends; open a claim when it comes back, follow
 * it received → sent to the supplier or a workshop → ready → delivered, and print the slip. A claim
 * moves no stock and posts nothing.
 */
export function WarrantyPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const [serial, setSerial] = useState(params.get('serial') ?? '');
  const [found, setFound] = useState<WarrantyLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [issue, setIssue] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [note, setNote] = useState('');
  const [technician, setTechnician] = useState('');
  const [loanItem, setLoanItem] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [claims, setClaims] = useState<WarrantyClaim[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [step, setStep] = useState<{
    claim: WarrantyClaim;
    status: Exclude<WarrantyStatus, 'received'>;
  } | null>(null);
  const [slip, setSlip] = useState<WarrantyClaim | null>(null);

  const reload = useCallback(() => {
    setListError(null);
    listClaims(status)
      .then((r) => setClaims(r.items))
      .catch((e: unknown) => setListError(errorMessage(e)));
  }, [status]);
  useEffect(reload, [reload]);

  async function search(event: FormEvent | null, typed = serial) {
    event?.preventDefault();
    setSearching(true);
    setLookupError(null);
    setFound(null);
    setOpenError(null);
    try {
      setFound(await lookupWarranty(typed.trim()));
    } catch (e) {
      setLookupError(fieldError(e));
    } finally {
      setSearching(false);
    }
  }

  // Coming from an invoice or a customer page: the serial is there, look it up at once
  const prefilled = params.get('serial');
  useEffect(() => {
    if (prefilled) void search(null, prefilled);
    // Once per arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  async function open(event: FormEvent) {
    event.preventDefault();
    if (!found) return;
    setOpening(true);
    setOpenError(null);
    try {
      const made = await openClaim({
        serial: found.serial,
        issue,
        ...(receivedOn ? { receivedOn } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(technician.trim() ? { technician: technician.trim() } : {}),
        ...(loanItem.trim() ? { loanItem: loanItem.trim() } : {}),
        // After the warranty a repair is paid for, by a till sale of a «صيانة» line
        ...(!found.underWarranty ? { paidRepair: true } : {}),
      });
      setTechnician('');
      setLoanItem('');
      setIssue('');
      setReceivedOn('');
      setNote('');
      setFound({ ...found, claims: [made, ...found.claims] });
      reload();
    } catch (e) {
      setOpenError(fieldError(e));
    } finally {
      setOpening(false);
    }
  }

  function print(claim: WarrantyClaim) {
    setSlip(claim);
    // The slip is in the page once React has drawn it
    setTimeout(() => window.print(), 0);
  }

  const hasOpen = found?.claims.some((c) => c.status !== 'delivered') ?? false;

  return (
    <AppShell>
      <title>الضمان والصيانة · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الضمان والصيانة"
          description="ابحث عن القطعة برقمها التسلسلي لترى فاتورتها وزبونها ونهاية كفالتها، وافتح مطالبة وتابعها حتى تُسلَّم."
        />

        <section aria-label="البحث بالرقم" className="flex flex-col gap-3">
          <SectionHead title="القطعة" description="اكتب الرقم التسلسلي أو IMEI كما هو على الجهاز." />
          <Card>
            <form noValidate onSubmit={(e) => void search(e)} className="flex flex-wrap items-end gap-3">
              <TextField
                label="الرقم التسلسلي أو IMEI"
                dir="ltr"
                inputClassName="num"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="w-full sm:w-80"
              />
              <Button
                type="submit"
                icon={<SearchIcon />}
                loading={searching}
                disabled={serial.trim().length < 3}
              >
                ابحث
              </Button>
            </form>
            {lookupError ? (
              <Alert tone="warning" className="mt-4">
                {lookupError}
              </Alert>
            ) : null}
            {found ? (
              <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-ink">{found.item}</h3>
                  <Badge tone={found.underWarranty ? 'success' : 'danger'}>
                    {found.underWarranty
                      ? 'تحت الكفالة'
                      : found.warrantyUntil
                        ? 'انتهت الكفالة'
                        : 'بلا كفالة'}
                  </Badge>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-ink-muted">الفاتورة</dt>
                    <dd className="num font-semibold">
                      <bdi dir="ltr">{found.saleNumber}</bdi> · {found.soldOn}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">الزبون</dt>
                    <dd className="font-semibold">{found.customerName ?? '—'}</dd>
                    {found.customerPhone ? (
                      <dd className="num text-ink-muted">
                        <bdi dir="ltr">{found.customerPhone}</bdi>
                      </dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-ink-muted">الكفالة حتى</dt>
                    <dd className="num font-semibold">{found.warrantyUntil ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">مطالبات سابقة</dt>
                    <dd className="num font-semibold">{found.claims.length}</dd>
                  </div>
                </dl>
                {hasOpen ? (
                  <Alert tone="info">عليها مطالبة مفتوحة، تجدها في القائمة تحت.</Alert>
                ) : (
                  <form noValidate onSubmit={(e) => void open(e)} className="flex flex-col gap-4">
                    {openError ? <Alert tone="error">{openError}</Alert> : null}
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                      <TextField label="العطل" value={issue} onChange={(e) => setIssue(e.target.value)} />
                      <DateField
                        label="تاريخ الاستلام (اتركه فارغاً لليوم)"
                        value={receivedOn}
                        onChange={setReceivedOn}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label="الفني (اختياري)"
                        value={technician}
                        onChange={(e) => setTechnician(e.target.value)}
                      />
                      <TextField
                        label="جهاز بديل مُعار للزبون (اختياري)"
                        hint="اسم الجهاز ورقمه إن أعرتَ الزبون جهازاً مكانه."
                        value={loanItem}
                        onChange={(e) => setLoanItem(e.target.value)}
                      />
                    </div>
                    {!found.underWarranty ? (
                      <Alert tone="info">
                        خارج الكفالة: الصيانة مدفوعة. حاسب الزبون من الصندوق ببند «صيانة»، ثم اكتب رقم
                        الفاتورة عند تسليم الجهاز.
                      </Alert>
                    ) : null}
                    <TextField
                      label="ملاحظة (اختياري)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div>
                      <Button type="submit" loading={opening} disabled={!issue.trim()}>
                        افتح مطالبة
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            ) : null}
          </Card>
        </section>

        <section aria-label="المطالبات" className="flex flex-col gap-3">
          <SectionHead
            title="المطالبات"
            description={status === 'open' ? 'ما لم يُسلَّم بعد، الأقدم أولاً.' : 'آخر 200 مطالبة.'}
          >
            <SegmentedControl
              label="العرض"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'open', label: 'المفتوحة' },
                { value: 'all', label: 'الكل' },
              ]}
            />
          </SectionHead>
          {listError ? <Alert tone="error">{listError}</Alert> : null}
          {claims && claims.length === 0 ? (
            <EmptyState
              icon={SerialIcon}
              title="لا مطالبات."
              description="تظهر هنا القطع التي رجعت للضمان أو الصيانة."
            />
          ) : null}
          <ul className="flex flex-col gap-3">
            {(claims ?? []).map((claim) => (
              <li key={claim.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <bdi dir="ltr" className="num font-semibold">
                      {claim.number}
                    </bdi>
                    <Badge tone={TONES[claim.status]}>{WARRANTY_STATUS_LABELS[claim.status]}</Badge>
                    <Badge tone={claim.underWarranty ? 'success' : 'neutral'}>
                      {claim.underWarranty ? 'تحت الكفالة' : 'خارج الكفالة'}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{claim.item}</span>
                    <bdi dir="ltr" className="num text-sm text-ink-muted">
                      {claim.serial}
                    </bdi>
                  </div>
                  <p className="text-sm text-ink">
                    {claim.issue}
                    <span className="text-ink-muted">
                      {' · '}
                      {claim.customerName ?? 'بدون زبون'}
                      {claim.sentTo ? ` · عند ${claim.sentTo}` : ''}
                      {claim.technician ? ` · الفني ${claim.technician}` : ''}
                      {claim.loanItem ? ` · أُعير ${claim.loanItem}` : ''}
                      {claim.paidRepair ? ' · صيانة مدفوعة' : ''}
                      {claim.costMinor !== null
                        ? ` · التكلفة ${formatMoney(claim.costMinor, me.settings.baseCurrency)}`
                        : ''}
                    </span>
                  </p>
                  <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                    {claim.events.map((event, i) => (
                      <li key={i}>
                        {WARRANTY_STATUS_LABELS[event.status]} <span className="num">{event.on}</span>
                        {event.note ? ` (${event.note})` : ''}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    {WARRANTY_NEXT[claim.status].map((next) => (
                      <Button
                        key={next}
                        variant={next === 'delivered' ? 'primary' : 'secondary'}
                        onClick={() =>
                          setStep({ claim, status: next as Exclude<WarrantyStatus, 'received'> })
                        }
                      >
                        {STEP_LABELS[next as Exclude<WarrantyStatus, 'received'>]}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      icon={<PrintIcon />}
                      aria-label={`اطبع ${claim.number}`}
                      onClick={() => print(claim)}
                    >
                      اطبع
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {step ? (
        <StepDialog
          claim={step.claim}
          status={step.status}
          onClose={() => setStep(null)}
          onDone={(claim) => {
            setStep(null);
            setFound((f) => (f ? { ...f, claims: f.claims.map((c) => (c.id === claim.id ? claim : c)) } : f));
            reload();
          }}
        />
      ) : null}
      {slip ? <ClaimSlip claim={slip} /> : null}
    </AppShell>
  );
}
