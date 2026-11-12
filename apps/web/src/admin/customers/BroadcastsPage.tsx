import { useCallback, useEffect, useId, useState } from 'react';
import { BROADCAST_FOOTER, type Broadcast, type BroadcastAudience, type Category } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CategoriesIcon,
  ChoiceCard,
  ClockIcon,
  CustomersIcon,
  EmptyState,
  EyeIcon,
  FieldGroup,
  IconChip,
  MegaphoneIcon,
  PageHeader,
  ProgressBar,
  Select,
  SendIcon,
  SkeletonText,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { zonedDateTime } from '../../lib/dates';
import { listCategories } from '../catalog/api';

const listBroadcasts = () => apiFetch<{ items: Broadcast[] }>('/v1/broadcasts', { auth: true });
const preview = (audience: BroadcastAudience) =>
  apiFetch<{ count: number }>('/v1/broadcasts/preview', { method: 'POST', body: { audience }, auth: true });
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
    <Card className="flex flex-col gap-4">
      <CardHeader icon={<EyeIcon />} title="كيف تصل" description="معاينة الرسالة على جوال الزبون." />
      <div aria-hidden="true" className="rounded-card bg-surface-muted p-4">
        <div className="me-8 flex flex-col gap-2 rounded-card rounded-ss-small bg-surface px-3.5 py-3 text-sm text-ink shadow-e1 ring-1 ring-line">
          <p className="font-semibold">{store}</p>
          <p className={typed ? 'break-words whitespace-pre-line' : 'text-ink-subtle'}>
            {typed || PLACEHOLDER}
          </p>
          <p className="text-ink-muted">{BROADCAST_FOOTER}</p>
          <span className="self-end text-xs text-ink-subtle">الآن</span>
        </div>
      </div>
      <p className="text-xs text-ink-subtle">يُضاف اسم المحل في أولها، وسطر الإيقاف في آخرها.</p>
    </Card>
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
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    listBroadcasts()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
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
      .then((r) => alive && setCount(r.count))
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
  return (
    <AppShell>
      <title>رسائل للزبائن · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <PageHeader
          title="رسائل للزبائن"
          description="رسالة على واتساب لزبائنك: «وصلت التشكيلة الشتوية» أو «تنزيلات 30٪»."
        />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Card>
            <CardHeader
              icon={<MegaphoneIcon />}
              title="رسالة جديدة"
              description="تُرسل واحدة كل ثانيتين حتى لا يُعدّ رقمك مزعجاً، ومعها سطر يقول كيف يوقفها الزبون."
            />
            <div className="flex flex-col gap-6">
              {error ? <Alert tone="error">{error}</Alert> : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={textId} className="text-sm font-semibold text-ink-muted">
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
                <p className="text-end text-sm text-ink-subtle">
                  <span className="num">{text.length}</span> / 700
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-5">
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                  <IconChip tone={count ? 'brand' : 'neutral'}>
                    <CustomersIcon />
                  </IconChip>
                  <div className="flex min-w-0 flex-col">
                    <p role="status" className="font-semibold text-ink">
                      {count === null
                        ? '…'
                        : count === 0
                          ? 'لا زبائن بأرقام جوال في هذا الاختيار.'
                          : `تصل إلى ${count} زبون.`}
                    </p>
                    {busy ? (
                      <span className="text-sm text-warning-ink">رسالة سابقة ما زالت تُرسل.</span>
                    ) : (
                      <span className="text-sm text-ink-muted">من علّمته «لا يريد رسائل» لا تصله.</span>
                    )}
                  </div>
                </div>
                <Button
                  icon={<SendIcon />}
                  loading={sending}
                  disabled={!audience || text.trim().length < 5 || !count || busy}
                  onClick={() => void go()}
                >
                  أرسل
                </Button>
              </div>
            </div>
          </Card>
          <aside className="lg:sticky lg:top-24">
            <MessagePreview store={me.tenant.name} text={text} />
          </aside>
        </div>
        <section aria-label="الرسائل السابقة" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-ink">الرسائل السابقة</h2>
            <p className="text-sm text-ink-muted">لمن ذهبت كل رسالة، وكم منها وصل.</p>
          </div>
          {items === null && !error ? (
            <Card aria-busy="true">
              <SkeletonText lines={3} />
            </Card>
          ) : null}
          {items && items.length === 0 ? (
            <EmptyState
              icon={MegaphoneIcon}
              title="لم تُرسل رسائل بعد."
              description="كل رسالة ترسلها تظهر هنا مع عدد من وصلته."
            />
          ) : null}
          {items && items.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-e1">
              {items.map((b) => (
                <li key={b.id} className="flex flex-col gap-3 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Badge tone={b.status === 'done' ? 'success' : 'warning'}>
                      {b.status === 'done' ? 'أُرسلت' : 'تُرسل الآن'}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">{AUDIENCE_TEXT(b.audience, names)}</span>
                    <span className="text-sm text-ink-subtle">
                      {zonedDateTime(b.createdAt, me.tenant.timezone, digits)}
                    </span>
                    <span className="num ms-auto text-sm font-semibold text-ink">
                      {b.sent} / {b.total}
                      {b.failed > 0 ? ` · لم تصل ${b.failed}` : ''}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm whitespace-pre-line text-ink-muted">{b.text}</p>
                  <ProgressBar
                    label="ما وصل إلى الزبائن"
                    value={b.sent}
                    max={b.total}
                    valueText={`${b.sent} من ${b.total}`}
                    tone={b.status === 'done' ? 'success' : 'brand'}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
