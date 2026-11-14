import { useEffect, useMemo, useRef, useState } from 'react';
import type { KitchenResponse, KitchenTicket, KitchenTicketLine, LineStatus } from '@serva/core';
import { Alert, Badge, Button, CheckIcon, ClockIcon, cn, EmptyState, ListIcon } from '@serva/ui';
import type { HallApi } from '../api';
import { elapsedText, lateness } from '../format';
import { usePoll } from '../usePoll';

const SECTION_KEY = 'kitchen.sections';

function savedSections(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(SECTION_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
  } catch {
    return null;
  }
}

function saveSections(sections: string[] | null): void {
  try {
    if (sections) globalThis.localStorage?.setItem(SECTION_KEY, JSON.stringify(sections));
    else globalThis.localStorage?.removeItem(SECTION_KEY);
  } catch {
    // Blocked storage: the choice lasts until the page is closed.
  }
}

/** A short beep for a new ticket; silent where the browser has no audio or has not allowed it. */
function beep(): void {
  try {
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    // No sound is not an error.
  }
}

const LATE_CLASS = {
  ok: 'border-line',
  late: 'border-warning',
  very_late: 'border-danger',
} as const;

const LATE_TEXT = {
  ok: 'text-ink-muted',
  late: 'text-warning-ink',
  very_late: 'text-danger-ink',
} as const;

/** The next step the kitchen's big button takes for a line */
const NEXT: Partial<Record<LineStatus, { to: 'preparing' | 'ready'; label: string }>> = {
  sent: { to: 'preparing', label: 'ابدأ التحضير' },
  preparing: { to: 'ready', label: 'جاهز' },
};

const STATUS_TEXT: Partial<Record<LineStatus, string>> = {
  sent: 'جديد',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  cancelled: 'ملغى',
};

function LineRow({
  line,
  busy,
  onMove,
  onAck,
}: {
  line: KitchenTicketLine;
  busy: boolean;
  onMove: (status: 'sent' | 'preparing' | 'ready') => void;
  onAck: () => void;
}) {
  const next = NEXT[line.status];
  const cancelled = line.status === 'cancelled';
  return (
    <li
      className={cn(
        'flex flex-col gap-2 border-t border-line px-4 py-3',
        cancelled && 'bg-danger-soft',
        line.status === 'ready' && 'bg-success-soft',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="num min-w-9 text-3xl leading-none font-bold text-ink">{line.qty}×</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('text-2xl leading-tight font-bold text-ink', cancelled && 'line-through')}>
            {line.name}
          </span>
          {line.choices.length > 0 ? (
            <span className="text-lg text-ink-muted">{line.choices.join(' · ')}</span>
          ) : null}
          {line.note ? <span className="text-lg font-semibold text-warning-ink">{line.note}</span> : null}
          {line.seat ? <span className="text-base text-ink-subtle">مقعد {line.seat}</span> : null}
        </div>
        <Badge
          tone={
            cancelled
              ? 'danger'
              : line.status === 'ready'
                ? 'success'
                : line.status === 'preparing'
                  ? 'warning'
                  : 'info'
          }
        >
          {STATUS_TEXT[line.status]}
        </Badge>
      </div>
      {cancelled ? (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-lg font-semibold text-danger-ink">
            ألغاه المدير{line.cancelReason ? `: ${line.cancelReason}` : ''}
          </span>
          <Button variant="secondary" size="lg" disabled={busy} onClick={onAck}>
            علمت
          </Button>
        </div>
      ) : next ? (
        <Button
          size="lg"
          variant={next.to === 'ready' ? 'primary' : 'secondary'}
          className="min-h-16 w-full text-xl"
          disabled={busy}
          onClick={() => onMove(next.to)}
          aria-label={`${next.label}: ${line.name}`}
        >
          {next.label}
        </Button>
      ) : line.status === 'ready' ? (
        <Button
          variant="ghost"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => onMove('preparing')}
          aria-label={`تراجع: ${line.name}`}
        >
          <CheckIcon size={20} /> جاهز · تراجع
        </Button>
      ) : null}
    </li>
  );
}

function TicketCard({
  ticket,
  now,
  busy,
  onMove,
  onAck,
}: {
  ticket: KitchenTicket;
  now: number;
  busy: boolean;
  onMove: (lineIds: string[], status: 'sent' | 'preparing' | 'ready') => void;
  onAck: (lineIds: string[]) => void;
}) {
  const late = lateness(ticket.createdAt, now);
  const open = ticket.lines.filter((l) => l.status === 'sent' || l.status === 'preparing');
  return (
    <li>
      <section
        aria-label={`تذكرة طاولة ${ticket.table} ${ticket.section}`}
        className={cn(
          'flex flex-col overflow-hidden rounded-card border-2 bg-surface shadow-e1',
          LATE_CLASS[late],
        )}
      >
        <header className="flex items-center gap-3 px-4 py-3">
          <span className="num text-4xl leading-none font-bold text-ink">{ticket.table}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-lg font-semibold text-ink">{ticket.section}</span>
            {ticket.kind === 'add' ? (
              <Badge tone="warning" className="self-start">
                إضافة
              </Badge>
            ) : null}
          </div>
          <span
            className={cn('num flex items-center gap-1.5 text-2xl font-bold', LATE_TEXT[late])}
            dir="ltr"
            aria-label="مضى على الطلب"
          >
            <ClockIcon size={20} />
            {elapsedText(ticket.createdAt, now)}
          </span>
        </header>
        <ul>
          {ticket.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              busy={busy}
              onMove={(status) => onMove([line.id], status)}
              onAck={() => onAck([line.id])}
            />
          ))}
        </ul>
        {open.length > 1 ? (
          <footer className="border-t border-line p-3">
            <Button
              variant="primary"
              size="lg"
              className="min-h-14 w-full text-lg"
              disabled={busy}
              onClick={() =>
                onMove(
                  open.map((l) => l.id),
                  'ready',
                )
              }
            >
              الكل جاهز
            </Button>
          </footer>
        ) : null}
      </section>
    </li>
  );
}

/**
 * «شاشة المطبخ» (03 › المطاعم): the section's tickets, oldest first, each line new → قيد التحضير →
 * جاهز with the time since it was sent, in type big enough to read across the kitchen. It asks the
 * server every few seconds; a new ticket flashes the top bar (and beeps, if sound is on).
 */
export function KitchenScreen({
  api,
  deviceName,
  pollMs = 4000,
  now = Date.now,
}: {
  api: HallApi;
  deviceName?: string;
  pollMs?: number;
  now?: () => number;
}) {
  const board = usePoll<KitchenResponse>(() => api.kitchen(), pollMs);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(savedSections);
  const [sound, setSound] = useState(false);
  const [flash, setFlash] = useState(false);
  const [tick, setTick] = useState(() => now());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);

  const tickets = useMemo(
    () => (board.data?.tickets ?? []).filter((t) => !chosen || chosen.includes(t.section)),
    [board.data, chosen],
  );

  // A ticket that was not here before flashes the bar once the first load is done
  useEffect(() => {
    if (!board.data) return;
    const ids = new Set(tickets.map((t) => t.id));
    const before = seen.current;
    seen.current = ids;
    if (!before || ![...ids].some((id) => !before.has(id))) return;
    setFlash(true);
    if (sound) beep();
    const timer = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [board.data, tickets, sound]);

  async function send(command: Parameters<HallApi['kitchenCommand']>[0]) {
    setBusy(true);
    setProblem(null);
    const answer = await api.kitchenCommand(command);
    setBusy(false);
    if (answer.kind === 'ok') {
      board.set(answer.body);
      return;
    }
    setProblem(answer.kind === 'refused' ? answer.message : 'لا يوجد اتصال بالخادم. أعد المحاولة.');
    void board.refresh();
  }

  const sections = board.data?.sections ?? [];
  function toggle(section: string | null) {
    const next =
      section === null
        ? null
        : chosen?.includes(section)
          ? chosen.filter((s) => s !== section)
          : [...(chosen ?? []), section];
    const value = next && next.length > 0 ? next : null;
    setChosen(value);
    saveSections(value);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header
        className={cn(
          'flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3 transition-colors',
          flash && 'bg-warning-soft motion-safe:animate-pulse',
        )}
      >
        <h1 className="text-2xl font-bold">المطبخ</h1>
        {deviceName ? <span className="text-base text-ink-muted">{deviceName}</span> : null}
        <span role="status" aria-live="polite" className="text-lg font-bold text-warning-ink">
          {flash ? 'تذكرة جديدة' : ''}
        </span>
        <span className="flex-1" />
        <nav aria-label="الأقسام" className="flex flex-wrap items-center gap-2">
          <Button
            variant={chosen ? 'secondary' : 'primary'}
            size="md"
            aria-pressed={!chosen}
            onClick={() => toggle(null)}
          >
            كل الأقسام
          </Button>
          {sections.map((section) => (
            <Button
              key={section}
              variant={chosen?.includes(section) ? 'primary' : 'secondary'}
              size="md"
              aria-pressed={chosen?.includes(section) ?? false}
              onClick={() => toggle(section)}
            >
              {section}
            </Button>
          ))}
        </nav>
        <Button variant="ghost" size="md" aria-pressed={sound} onClick={() => setSound((s) => !s)}>
          {sound ? 'الصوت يعمل' : 'الصوت متوقف'}
        </Button>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4 empty:hidden">
        {!board.online ? (
          <Alert tone="warning">
            لا يوجد اتصال بالخادم. تبقى آخر التذاكر على الشاشة وتتحدّث عند عودة الاتصال.
          </Alert>
        ) : null}
        {board.refusal ? <Alert tone="error">{board.refusal}</Alert> : null}
        {problem ? <Alert tone="error">{problem}</Alert> : null}
      </div>

      <main className="flex-1 p-4">
        {board.data && tickets.length === 0 ? (
          <EmptyState
            icon={ListIcon}
            title="لا طلبات الآن"
            description="تظهر التذاكر هنا فور إرسالها من النادل أو الكاشير."
          />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] items-start gap-4">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                now={tick}
                busy={busy}
                onMove={(lineIds, status) => void send({ type: 'status', lineIds, status })}
                onAck={(lineIds) => void send({ type: 'ack', lineIds })}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
