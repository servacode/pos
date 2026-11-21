import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BROADCAST_FOOTER,
  MAX_BROADCAST_RECIPIENTS,
  type Broadcast,
  type BroadcastAudience,
  type Category,
} from '@serva/core';
import {
  Alert,
  Button,
  CategoriesIcon,
  CheckIcon,
  ChoiceCard,
  ClockIcon,
  CustomersIcon,
  FieldGroup,
  MegaphoneIcon,
  Select,
  SendIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { zonedDateTime } from '../../lib/dates';
import { listCategories } from '../catalog/api';
import { PageTop, Panel, SalesPage, StatusPill } from '../sales/ui';
import { Empty } from './parts';

const listBroadcasts = () => apiFetch<{ items: Broadcast[] }>('/v1/broadcasts', { auth: true });
const preview = (audience: BroadcastAudience) =>
  apiFetch<{ count: number; max?: number }>('/v1/broadcasts/preview', {
    method: 'POST',
    body: { audience },
    auth: true,
  });
const send = (text: string, audience: BroadcastAudience) =>
  apiFetch<Broadcast>('/v1/broadcasts', { method: 'POST', body: { text, audience }, auth: true });

type Kind = BroadcastAudience['kind'];

function audienceOf(kind: Kind, categoryId: string, days: number): BroadcastAudience | null {
  if (kind === 'all') return { kind };
  if (kind === 'recent') return { kind, days };
  return categoryId ? { kind, categoryId } : null;
}

const AUDIENCE_TEXT = (a: BroadcastAudience, names: Map<string, string>) =>
  a.kind === 'all'
    ? 'كل الزبائن'
    : a.kind === 'recent'
      ? `من اشترى في آخر ${a.days} يوماً`
      : `زبائن ${names.get(a.categoryId) ?? 'قسم'}`;

/** The three audiences, as big choices. */
const AUDIENCES: { kind: Kind; title: string; description: string; icon: typeof CustomersIcon }[] = [
  { kind: 'all', title: 'كل الزبائن', description: 'كل من له رقم جوال في دفاترك', icon: CustomersIcon },
  {
    kind: 'category',
    title: 'من اشترى من قسم',
    description: 'مثلاً من اشترى أحذية، لتشكيلة أحذية جديدة',
    icon: CategoriesIcon,
  },
  {
    kind: 'recent',
    title: 'من اشترى مؤخراً',
    description: 'زبائن الأشهر الأخيرة، من شهر إلى سنة',
    icon: ClockIcon,
  },
];

const PLACEHOLDER = 'وصلت التشكيلة الشتوية! مرّوا علينا، أو اطلبوا من متجرنا.';

/** The message as it reaches a customer's WhatsApp: the store's name, the words, the line to stop them. */
function MessagePreview({ store, text }: { store: string; text: string }) {
  const typed = text.trim();
  return (
    <Panel title="كيف تصل" aside="معاينة الرسالة على جوال الزبون">
      <div aria-hidden="true" className="cx-bubble">
        <p className="m-0 font-semibold">{store}</p>
        <p className={typed ? 'm-0' : 'sx-sub m-0'}>{typed || PLACEHOLDER}</p>
        <p className="sx-mute m-0">{BROADCAST_FOOTER}</p>
      </div>
      <p className="sx-wait mt-3">يُضاف اسم المحل في أولها، وسطر الإيقاف في آخرها.</p>
    </Panel>
  );
}

/**
 * «رسائل للزبائن» (03 › الألبسة): a WhatsApp message to the store's customers with a phone (all of
 * them, those who bought from a department, or those who bought lately), sent one at a time through
 * the store's message gateway. Customers marked «لا يريد رسائل» never get one.
 */
export function BroadcastsPage() {
  const me = useMe();
  const digits = useDigits();
  const textId = useId();
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [categoryId, setCategoryId] = useState('');
  const [days, setDays] = useState(90);
  const [count, setCount] = useState<number | null>(null);
  const [max, setMax] = useState(MAX_BROADCAST_RECIPIENTS);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    listBroadcasts()
      .then((r) => mounted.current && setItems(r.items))
      .catch((e: unknown) => mounted.current && setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    listCategories()
      .then((r) => setCategories(r.items.filter((c) => !c.archivedAt && !c.parentId)))
      .catch(() => setCategories([]));
  }, []);

  const audience = audienceOf(kind, categoryId, days);
  useEffect(() => {
    setCount(null);
    if (!audience) return;
    let alive = true;
    preview(audience)
      .then((r) => {
        if (!alive) return;
        setCount(r.count);
        if (r.max) setMax(r.max);
      })
      .catch(() => alive && setCount(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the audience is its three parts
  }, [kind, categoryId, days]);

  // While one is going out, its count moves
  const busy = items?.some((b) => b.status === 'sending') ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [busy, load]);

  async function go() {
    if (!audience) return;
    setSending(true);
    setError(null);
    try {
      await send(text, audience);
      setText('');
      load();
    } catch (e) {
      const fields = e instanceof ApiError ? Object.values(e.fields ?? {}) : [];
      setError(fields[0] ?? errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const names = new Map(categories.map((c) => [c.id, c.name]));
  const tooMany = count !== null && count > max;
  const typedOk = text.trim().length >= 5;
  // Why the button is off, said beside it
  const why = !audience
    ? 'اختر القسم أولاً'
    : !typedOk
      ? 'اكتب الرسالة أولاً'
      : tooMany
        ? `أكثر من ${max} زبون: اختر قسماً أو مدة أقصر.`
        : busy
          ? 'رسالة سابقة ما زالت تُرسل.'
          : null;
  return (
    <AppShell>
      <title>رسائل للزبائن · SERVA</title>
      <SalesPage>
        <PageTop
          title="رسائل للزبائن"
          subtitle="رسالة على واتساب لزبائنك: «وصلت التشكيلة الشتوية» أو «تنزيلات 30٪»."
        />
        <div className="cx-compose">
          <Panel
            title="رسالة جديدة"
            aside="تُرسل واحدة كل ثانيتين حتى لا يُعدّ رقمك مزعجاً، ومعها سطر يقول كيف يوقفها الزبون."
          >
            <div className="flex flex-col gap-6">
              {error ? <Alert tone="error">{error}</Alert> : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={textId} className="sx-eyebrow">
                  الرسالة
                </label>
                <textarea
                  id={textId}
                  aria-label="الرسالة"
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, 700))}
                  rows={5}
                  placeholder={PLACEHOLDER}
                  className="w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden pointer-coarse:text-base"
                />
                <p className="sx-wait m-0 text-end">
                  <bdi dir="ltr" className="sx-n">
                    {text.length} / 700
                  </bdi>
                </p>
              </div>
              <FieldGroup legend="لمن">
                <div className="grid gap-3">
                  {AUDIENCES.map((a) => {
                    const AudienceIcon = a.icon;
                    return (
                      <ChoiceCard
                        key={a.kind}
                        name="audience"
                        value={a.kind}
                        title={a.title}
                        description={a.description}
                        leading={<AudienceIcon />}
                        checked={kind === a.kind}
                        onChange={() => setKind(a.kind)}
                      />
                    );
                  })}
                </div>
              </FieldGroup>
              {kind === 'category' ? (
                <Select
                  label="القسم"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="sm:max-w-xs"
                >
                  <option value="">اختر القسم</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              {kind === 'recent' ? (
                <Select
                  label="في آخر"
                  value={String(days)}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="sm:max-w-xs"
                >
                  {[30, 60, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>
                      {d} يوماً
                    </option>
                  ))}
                </Select>
              ) : null}
              <div className="cx-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="flex min-w-0 flex-col">
                  <p role="status" className="m-0 font-semibold">
                    {count === null
                      ? '…'
                      : count === 0
                        ? 'لا زبائن بأرقام جوال في هذا الاختيار.'
                        : tooMany
                          ? `يصل إلى ${count} زبون، والحد ${max}.`
                          : `تصل إلى ${count} زبون.`}
                  </p>
                  <span className="sx-wait">{why ?? 'من علّمته «لا يريد رسائل» لا تصله.'}</span>
                </div>
                <Button
                  icon={<SendIcon />}
                  loading={sending}
                  disabled={!audience || !typedOk || !count || tooMany || busy}
                  onClick={() => void go()}
                >
                  أرسل
                </Button>
              </div>
            </div>
          </Panel>
          <aside className="lg:sticky lg:top-24">
            <MessagePreview store={me.tenant.name} text={text} />
          </aside>
        </div>
        <Panel title="الرسائل السابقة" aside="لمن ذهبت كل رسالة، وكم منها وصل." flush>
          {items === null && !error ? <p className="sx-wait p-4">نحمّل الرسائل…</p> : null}
          {items && items.length === 0 ? (
            <Empty icon={<MegaphoneIcon size={24} />} title="لم تُرسل رسائل بعد.">
              <p>كل رسالة ترسلها تظهر هنا مع عدد من وصلته.</p>
            </Empty>
          ) : null}
          {items && items.length > 0 ? (
            <ul className="cx-stm" aria-label="الرسائل السابقة">
              {items.map((b) => (
                <li key={b.id}>
                  <span className="what">
                    {b.status === 'done' ? (
                      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
                        أُرسلت
                      </StatusPill>
                    ) : (
                      <StatusPill kind="warn">تُرسل الآن</StatusPill>
                    )}{' '}
                    {AUDIENCE_TEXT(b.audience, names)}
                  </span>
                  <span className="end font-semibold">
                    <span className="sx-n">
                      {b.sent} / {b.total}
                      {b.failed > 0 ? ` · لم تصل ${b.failed}` : ''}
                    </span>
                  </span>
                  <span className="row2">
                    <span className="line-clamp-2 whitespace-pre-line">{b.text}</span>
                    <span className="sx-n">{zonedDateTime(b.createdAt, me.tenant.timezone, digits)}</span>
                  </span>
                  <span className="cx-bar" style={{ gridColumn: '1 / -1' }} aria-hidden="true">
                    <i style={{ width: `${b.total ? Math.round((b.sent / b.total) * 100) : 0}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </SalesPage>
    </AppShell>
  );
}
