import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AlterationTicket } from '@serva/core/contracts/alterations';
import { Alert, BackIcon, Badge, Button, cn, Money, PrintIcon, TextField } from '@serva/ui';
import { APP_VERSION } from '../../offline/sync';
import type { Catalog } from '../catalog';
import { parseAmount } from '../pay/payment';
import { usePos } from '../services';

type Answer<T> = { kind: 'ok'; body: T } | { kind: 'refused'; message: string } | { kind: 'network' };

/** The till's calls for alteration tickets (`Authorization: Device <token>`); they need the server */
async function call<T>(
  path: string,
  token: string,
  fetchFn: typeof fetch | undefined,
  body?: unknown,
): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await (fetchFn ?? globalThis.fetch)(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Device ${token}`,
        'X-App-Version': APP_VERSION,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { kind: 'network' };
  }
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string; fields?: Record<string, string> } }) | null;
  if (res.ok && json) return { kind: 'ok', body: json };
  if (res.status >= 500 || !json) return { kind: 'network' };
  const fields = Object.values(json.error?.fields ?? {});
  return { kind: 'refused', message: fields[0] ?? json.error?.message ?? 'رُفض الطلب.' };
}

const STATUS_TEXT: Record<AlterationTicket['status'], string> = {
  received: 'قيد التعديل',
  ready: 'جاهزة للاستلام',
  delivered: 'سُلّمت',
};

/** Today plus `days`, YYYY-MM-DD in the browser's calendar */
const inDays = (days: number, now: number) => new Date(now + days * 86_400_000).toLocaleDateString('en-CA');

/**
 * «التعديلات» (03 › الألبسة: التعديل والتقصير): a piece left to be shortened or altered gets a
 * numbered ticket with the work, the fee and the day it is ready, printed for the customer; the list
 * shows what is in work and what is ready, the soonest first. The fee is sold at collection like any
 * service («تقصير»).
 */
export function AlterationsScreen({ catalog, onBack }: { catalog: Catalog; onBack: () => void }) {
  const pos = usePos();
  const base = catalog.settings!.baseCurrency;
  const [items, setItems] = useState<AlterationTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [item, setItem] = useState('');
  const [work, setWork] = useState('');
  const [price, setPrice] = useState('');
  const [due, setDue] = useState(() => inDays(2, pos.now()));
  const [saving, setSaving] = useState(false);
  const [slip, setSlip] = useState<AlterationTicket | null>(null);

  const token = pos.device.token;
  const load = useCallback(async () => {
    if (!token || !pos.online()) {
      setError('التعديلات تحتاج اتصالاً بالخادم.');
      setItems([]);
      return;
    }
    const answer = await call<{ items: AlterationTicket[] }>('/v1/device/alterations', token, pos.fetch);
    if (answer.kind === 'ok') {
      setItems(answer.body.items);
      setError(null);
    } else {
      setItems([]);
      setError(answer.kind === 'refused' ? answer.message : 'تعذّر الوصول إلى الخادم.');
    }
  }, [pos, token]);
  useEffect(() => {
    void load();
  }, [load]);

  // The slip prints once it is on the page
  useEffect(() => {
    if (!slip) return;
    window.print();
  }, [slip]);

  const priceMinor = price.trim() ? parseAmount(price, base) : 0;
  const ready = name.trim() && phone.trim() && item.trim() && work.trim() && priceMinor !== null && due;

  async function create() {
    if (!ready || !token) return;
    setSaving(true);
    setError(null);
    const answer = await call<AlterationTicket>('/v1/device/alterations', token, pos.fetch, {
      customerName: name.trim(),
      phone: phone.trim(),
      item: item.trim(),
      work: work.trim(),
      priceMinor,
      dueDate: due,
      note: null,
    });
    setSaving(false);
    if (answer.kind !== 'ok') {
      setError(answer.kind === 'refused' ? answer.message : 'لم تُسجَّل التذكرة: لا اتصال بالخادم.');
      return;
    }
    setSlip({ ...answer.body });
    setName('');
    setPhone('');
    setItem('');
    setWork('');
    setPrice('');
    void load();
  }

  async function move(t: AlterationTicket, status: 'ready' | 'delivered') {
    if (!token) return;
    const answer = await call<AlterationTicket>(`/v1/device/alterations/${t.id}/status`, token, pos.fetch, {
      status,
      version: t.version,
    });
    if (answer.kind !== 'ok')
      setError(answer.kind === 'refused' ? answer.message : 'تعذّر الوصول إلى الخادم.');
    void load();
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">التعديلات</h1>
          <p className="text-ink-muted">
            تقصير وتضييق وتعديل: تذكرة بموعد التسليم، وتُباع الأجرة عند الاستلام.
          </p>
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <section
        aria-label="تذكرة جديدة"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
      >
        <h2 className="text-xl font-bold text-ink">تذكرة جديدة</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="اسم الزبون" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} />
          <TextField
            label="جوال الزبون"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 20))}
          />
          <TextField
            label="القطعة"
            placeholder="بنطال جينز أسود"
            value={item}
            onChange={(e) => setItem(e.target.value.slice(0, 120))}
          />
          <TextField
            label="المطلوب"
            placeholder="تقصير 3 سم"
            value={work}
            onChange={(e) => setWork(e.target.value.slice(0, 200))}
          />
          <TextField
            label="الأجرة"
            dir="ltr"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.slice(0, 12))}
            error={priceMinor === null ? 'مبلغ غير صحيح' : undefined}
          />
          <TextField
            label="موعد التسليم"
            type="date"
            dir="ltr"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div>
          <Button loading={saving} disabled={!ready} icon={<PrintIcon />} onClick={() => void create()}>
            سجّل واطبع التذكرة
          </Button>
        </div>
      </section>
      <section aria-label="التذاكر المفتوحة" className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-ink">التذاكر المفتوحة</h2>
        {items && items.length === 0 && !error ? <p className="text-ink-muted">لا تعديلات مفتوحة.</p> : null}
        <ul className="flex flex-col gap-2">
          {(items ?? []).map((t) => (
            <li
              key={t.id}
              aria-label={`التذكرة ${t.number}`}
              className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface p-3"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold">
                  <bdi dir="ltr" className="num">
                    {t.number}
                  </bdi>{' '}
                  · {t.customerName}
                </span>
                <span className="text-sm text-ink-muted">
                  {t.item}: {t.work}
                </span>
                <span className="text-sm text-ink-muted">
                  التسليم <span className="num">{t.dueDate}</span> ·{' '}
                  <Money minor={t.priceMinor} currency={t.currency} />
                </span>
              </span>
              <Badge tone={t.status === 'ready' ? 'success' : 'warning'}>{STATUS_TEXT[t.status]}</Badge>
              {t.status === 'received' ? (
                <Button size="sm" variant="secondary" onClick={() => void move(t, 'ready')}>
                  جاهزة
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void move(t, 'delivered')}>
                سُلّمت
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {slip ? <PrintableAlteration ticket={slip} store={catalog.settings!.storeName} /> : null}
    </div>
  );
}

/** The customer's slip: the number big, the piece, the work, the fee and the day to come back */
export function AlterationSlip({ ticket, store }: { ticket: AlterationTicket; store: string }) {
  return (
    <section
      dir="rtl"
      lang="ar"
      aria-label="تذكرة التعديل"
      className={cn(
        'flex w-[72mm] flex-col gap-2 bg-surface px-1 py-3 text-[13px]/[1.55] font-semibold text-ink',
      )}
    >
      <div className="flex flex-col items-center">
        <span className="text-base font-bold">{store}</span>
        <span>تذكرة تعديل</span>
        <bdi dir="ltr" className="num text-2xl font-bold">
          {ticket.number}
        </bdi>
      </div>
      <hr className="border-dashed border-ink" />
      <span>الزبون: {ticket.customerName}</span>
      <span>القطعة: {ticket.item}</span>
      <span>المطلوب: {ticket.work}</span>
      <span>
        الأجرة: <Money minor={ticket.priceMinor} currency={ticket.currency} />
      </span>
      <span className="text-base font-bold">
        الاستلام: <span className="num">{ticket.dueDate}</span>
      </span>
      <hr className="border-dashed border-ink" />
      <p className="text-center text-xs">أحضر هذه التذكرة عند الاستلام.</p>
    </section>
  );
}

function PrintableAlteration({ ticket, store }: { ticket: AlterationTicket; store: string }) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{'@page { size: 80mm auto; margin: 0 }'}</style>
      <AlterationSlip ticket={ticket} store={store} />
    </div>,
    document.body,
  );
}
