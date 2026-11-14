import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toMinor, type MaintenanceContract } from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Money,
  PageHeader,
  SegmentedControl,
  SerialIcon,
  TextField,
  useDigits,
  type BadgeTone,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { dayText } from '../../lib/dates';
import { ApiError, errorMessage } from '../../lib/api';
import { SectionHead } from '../purchases/parts';
import { createContract, listContracts, logVisit, renewContract } from './api';

const fieldError = (e: unknown) =>
  e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e);

const STATE_TEXT: Record<MaintenanceContract['state'], [string, BadgeTone]> = {
  active: ['ساري', 'success'],
  ending: ['يقترب انتهاؤه', 'warning'],
  ended: ['منتهٍ', 'neutral'],
  cancelled: ['ملغى', 'neutral'],
};

/** A day in the browser's calendar, YYYY-MM-DD */
const isoOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA');

function NewContract({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [serials, setSerials] = useState('');
  const [startDate, setStartDate] = useState(() => isoOf(Date.now()));
  const [endDate, setEndDate] = useState(() => isoOf(Date.now() + 365 * 86_400_000));
  const [every, setEvery] = useState('3');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let priceMinor: number;
    try {
      priceMinor = price.trim() ? toMinor(price, me.settings.baseCurrency) : 0;
    } catch {
      setError('اكتب السعر رقماً.');
      return;
    }
    const devices = serials
      .split(/[\n,،]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((serial) => ({ serial }));
    setSaving(true);
    try {
      await createContract({
        customerName: customerName.trim(),
        customerPhone: phone.trim() || null,
        devices,
        startDate,
        endDate,
        visitEveryMonths: Number(every),
        priceMinor,
      });
      setCustomerName('');
      setPhone('');
      setSerials('');
      setPrice('');
      onDone();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="الزبون" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <TextField
            label="جوال الزبون (اختياري)"
            dir="ltr"
            inputClassName="num"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
          الأجهزة: رقم تسلسلي في كل سطر
          <textarea
            dir="ltr"
            rows={3}
            value={serials}
            onChange={(e) => setSerials(e.target.value)}
            className="num rounded-control border border-line-control bg-surface p-3 font-normal"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-4">
          <TextField
            label="من"
            type="date"
            dir="ltr"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            label="إلى"
            type="date"
            dir="ltr"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <TextField
            label="زيارة كل (أشهر)"
            dir="ltr"
            inputMode="numeric"
            inputClassName="num"
            value={every}
            onChange={(e) => setEvery(e.target.value)}
          />
          <TextField
            label="سعر العقد"
            dir="ltr"
            inputMode="decimal"
            inputClassName="num"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div>
          <Button
            type="submit"
            icon={<AddIcon />}
            loading={saving}
            disabled={!customerName.trim() || !serials.trim()}
          >
            أضف العقد
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VisitDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: MaintenanceContract;
  onClose: () => void;
  onDone: () => void;
}) {
  const [technician, setTechnician] = useState('');
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await logVisit(contract.id, {
        technician: technician.trim(),
        ...(on ? { on } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        version: contract.version,
      });
      onDone();
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
      title={`زيارة صيانة: ${contract.number}`}
      description={contract.customerName}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" form="maintenance-visit" loading={saving} disabled={!technician.trim()}>
            سجّل الزيارة
          </Button>
        </>
      }
    >
      <form
        id="maintenance-visit"
        noValidate
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-4"
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField label="الفني" value={technician} onChange={(e) => setTechnician(e.target.value)} />
        <TextField
          label="التاريخ (اتركه فارغاً لليوم)"
          type="date"
          dir="ltr"
          value={on}
          onChange={(e) => setOn(e.target.value)}
        />
        <TextField label="ملاحظات (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      </form>
    </Dialog>
  );
}

/**
 * «عقود الصيانة» (03 › الأدوات الطبية): a customer's devices serviced every few months over a period.
 * The upcoming visits first, each visit logged with its technician and notes, a reminder before the
 * contract ends and a renewal into the next period. The price is sold at the till as a «عقد صيانة»
 * line; the contract posts nothing.
 */
export function MaintenancePage() {
  const digits = useDigits();
  const [view, setView] = useState<'upcoming' | 'all'>('upcoming');
  const [items, setItems] = useState<MaintenanceContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [visiting, setVisiting] = useState<MaintenanceContract | null>(null);

  const load = useCallback(() => {
    setError(null);
    listContracts(view)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [view]);
  useEffect(load, [load]);

  async function renew(c: MaintenanceContract) {
    setError(null);
    try {
      await renewContract(c.id, c.version);
      load();
    } catch (e) {
      setError(fieldError(e));
    }
  }

  return (
    <AppShell>
      <title>عقود الصيانة · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="عقود الصيانة"
          description="أجهزة الزبائن التي تُصان كل بضعة أشهر: الزيارات القادمة، سجل الزيارات، وتذكير بالتجديد."
          actions={
            <Button icon={<AddIcon />} onClick={() => setAdding((v) => !v)}>
              عقد جديد
            </Button>
          }
        />
        {adding ? (
          <NewContract
            onDone={() => {
              setAdding(false);
              load();
            }}
          />
        ) : null}
        <section aria-label="العقود" className="flex flex-col gap-3">
          <SectionHead
            title={view === 'upcoming' ? 'زيارات خلال 30 يوماً أو متأخرة' : 'كل العقود'}
            description="يُحصَّل سعر العقد من الصندوق ببند «عقد صيانة»."
          >
            <SegmentedControl
              label="العرض"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'upcoming', label: 'القادمة' },
                { value: 'all', label: 'الكل' },
              ]}
            />
          </SectionHead>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {items && items.length === 0 ? (
            <EmptyState
              icon={SerialIcon}
              title={view === 'upcoming' ? 'لا زيارات قريبة.' : 'لا عقود صيانة.'}
              description="أضف عقداً بزر «عقد جديد»، وتظهر هنا زياراته عند اقترابها."
            />
          ) : null}
          <ul className="flex flex-col gap-3">
            {(items ?? []).map((c) => {
              const [stateText, stateTone] = STATE_TEXT[c.state];
              return (
                <li key={c.id}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <bdi dir="ltr" className="num font-semibold">
                        {c.number}
                      </bdi>
                      <Badge tone={stateTone}>{stateText}</Badge>
                      {c.visitOverdue ? <Badge tone="danger">زيارة متأخرة</Badge> : null}
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.customerName}</span>
                      <Money minor={c.priceMinor} currency={c.currency} className="font-semibold" />
                    </div>
                    <p className="text-sm text-ink-muted">
                      من {dayText(c.startDate, digits)} إلى {dayText(c.endDate, digits)} · زيارة كل{' '}
                      <span className="num">{c.visitEveryMonths}</span> أشهر
                      {c.nextVisit ? ` · القادمة ${dayText(c.nextVisit, digits)}` : ' · لا زيارات متبقية'}
                      {c.billedOn ? ` · حُصّل ${dayText(c.billedOn, digits)}` : ' · لم يُحصَّل بعد'}
                    </p>
                    <ul className="flex flex-wrap gap-2 text-sm">
                      {c.devices.map((d) => (
                        <li key={d.serial} className="rounded-control bg-surface-muted px-2 py-1">
                          {d.item}{' '}
                          <bdi dir="ltr" className="num text-ink-muted">
                            {d.serial}
                          </bdi>
                        </li>
                      ))}
                    </ul>
                    {c.visits.length > 0 ? (
                      <ol className="flex flex-col gap-0.5 text-xs text-ink-muted">
                        {c.visits.map((v, i) => (
                          <li key={i}>
                            {dayText(v.on, digits)} · {v.technician}
                            {v.note ? ` · ${v.note}` : ''}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {c.state !== 'ended' && c.state !== 'cancelled' ? (
                        <Button variant="secondary" onClick={() => setVisiting(c)}>
                          سجّل زيارة
                        </Button>
                      ) : null}
                      {c.state === 'ending' || c.state === 'ended' ? (
                        <Button onClick={() => void renew(c)}>جدّد العقد</Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {visiting ? (
        <VisitDialog
          contract={visiting}
          onClose={() => setVisiting(null)}
          onDone={() => {
            setVisiting(null);
            load();
          }}
        />
      ) : null}
    </AppShell>
  );
}
