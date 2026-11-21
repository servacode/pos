import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { CheckIcon, NextIcon, NotificationsIcon, Tooltip, type Icon } from '@serva/ui';
import { isoDay, zonedClock, dayText } from '../lib/dates';
import { formatNumber, type NumberFormat } from '../lib/format';
import { clamp, usePopover } from './popover';

/** One line of the bell's list: something that waits for the user, and where to deal with it. */
export interface Notice {
  key: string;
  to: string;
  icon: Icon;
  tone: 'brand' | 'warning' | 'danger' | 'info';
  title: string;
  detail?: string;
  /** How many: the shop's orders, the holds. */
  count?: number;
  /** What counts toward the bell's dot (0 for news that asks for nothing yet). */
  attention: number;
  /** When it happened (the latest order's time); a state of the plan has none and counts as today. */
  at?: string;
}

// ── Read state, per signed-in user, on this device ───────────────────────────────────────────────

const readKey = (userId: string) => `serva.notices.read.${userId}`;

function loadReads(userId: string): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(readKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A notice is a new one again when its count or its time changes: «3 طلبات» read, a 4th arrives. */
const signature = (notice: Notice) =>
  `${String(notice.count ?? 0)}|${notice.at ?? ''}|${notice.tone}|${notice.title}`;

function useNoticeReads(userId: string, notices: readonly Notice[]) {
  const [reads, setReads] = useState(() => loadReads(userId));
  useEffect(() => setReads(loadReads(userId)), [userId]);

  const save = useCallback(
    (next: Record<string, string>) => {
      setReads(next);
      try {
        globalThis.localStorage?.setItem(readKey(userId), JSON.stringify(next));
      } catch {
        // Storage refused: the notices stay read for this page only.
      }
    },
    [userId],
  );

  const isUnread = useCallback(
    (notice: Notice) => notice.attention > 0 && reads[notice.key] !== signature(notice),
    [reads],
  );
  const markRead = useCallback(
    (notice: Notice) => save({ ...reads, [notice.key]: signature(notice) }),
    [reads, save],
  );
  const markAll = useCallback(
    () => save({ ...reads, ...Object.fromEntries(notices.map((notice) => [notice.key, signature(notice)])) }),
    [reads, notices, save],
  );
  return { isUnread, markRead, markAll };
}

// ── Time, in words ───────────────────────────────────────────────────────────────────────────────

const rules = new Intl.PluralRules('ar');

/** «قبل دقيقتين», «قبل 5 دقائق»: the Arabic forms of a count of minutes or hours. */
function ago(
  count: number,
  unit: { one: string; two: string; few: string; many: string },
  fmt: NumberFormat,
) {
  const n = formatNumber(count, fmt);
  switch (rules.select(count)) {
    case 'one':
      return `قبل ${unit.one}`;
    case 'two':
      return `قبل ${unit.two}`;
    case 'few':
      return `قبل ${n} ${unit.few}`;
    default:
      return `قبل ${n} ${unit.many}`;
  }
}

export interface NoticeClock {
  now: number;
  timeZone: string;
  numberFormat: NumberFormat;
}

/** «قبل 4 دقائق» within the hour, «قبل ساعتين» within the day, «أمس 9:40 م», then the date. */
export function noticeTime(at: string, clock: NoticeClock): string {
  const ms = Date.parse(at);
  const { now, timeZone, numberFormat: fmt } = clock;
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  const today = isoDay(now, timeZone);
  const day = isoDay(ms, timeZone);
  if (day === today) {
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return ago(minutes, { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' }, fmt);
    return ago(Math.floor(minutes / 60), { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' }, fmt);
  }
  if (day === isoDay(now - 86_400_000, timeZone)) return `أمس ${zonedClock(at, timeZone, fmt)}`;
  return dayText(day, fmt);
}

/** «إشعار واحد», «إشعاران», «5 إشعارات», «12 إشعاراً». */
function noticeCount(count: number, text: string): string {
  if (count === 1) return 'إشعار واحد';
  if (count === 2) return 'إشعاران';
  return count <= 10 ? `${text} إشعارات` : `${text} إشعاراً`;
}

type Bucket = 'today' | 'yesterday' | 'older';
const BUCKETS: readonly { key: Bucket; label: string }[] = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'older', label: 'قبل ذلك' },
];

function bucketOf(notice: Notice, clock: NoticeClock): Bucket {
  if (!notice.at) return 'today';
  const day = isoDay(Date.parse(notice.at), clock.timeZone);
  if (day === isoDay(clock.now, clock.timeZone)) return 'today';
  return day === isoDay(clock.now - 86_400_000, clock.timeZone) ? 'yesterday' : 'older';
}

// ── The bell ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The bell and its popover (هوية 4, round 45): what waits, grouped by day, each line a link to where
 * it is dealt with, an unread dot with the word for it (never colour alone), «تعليم الكل كمقروء»
 * and «اعرض الكل». It asks the server nothing: the frame hands it what it knows. On a phone the same
 * box is a bottom sheet.
 */
export function Notifications({
  notices,
  userId,
  timeZone,
  numberFormat,
}: {
  notices: Notice[];
  userId: string;
  timeZone: string;
  numberFormat: NumberFormat;
}) {
  const { isUnread, markRead, markAll } = useNoticeReads(userId, notices);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const titleId = useId();
  const panelId = useId();
  const pop = usePopover((anchor, box, view) => ({
    left: clamp(
      anchor.left + anchor.width / 2 - box.width / 2,
      12,
      Math.max(12, view.width - box.width - 12),
    ),
    top: anchor.bottom + 8,
  }));

  const unread = notices.filter(isUnread).length;
  // A fresh «now» each time the box draws, so «قبل 4 دقائق» is not stale when it opens.
  const clock: NoticeClock = { now: Date.now(), timeZone, numberFormat };
  const shown = onlyUnread ? notices.filter(isUnread) : notices;
  const total = formatNumber(notices.length, numberFormat);

  useEffect(() => {
    if (pop.open) pop.box.current?.focus({ preventScroll: true });
  }, [pop.open, pop.box]);
  useEffect(() => {
    if (!pop.open) setOnlyUnread(false);
  }, [pop.open]);

  const label = unread > 0 ? `التنبيهات (${String(unread)})` : 'التنبيهات';
  return (
    <>
      <Tooltip content={pop.open ? null : 'التنبيهات'} side="bottom">
        <button
          ref={pop.trigger}
          type="button"
          className="sh-ibtn"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={pop.open}
          aria-controls={pop.open ? panelId : undefined}
          onClick={() => pop.setOpen(!pop.open)}
        >
          <NotificationsIcon />
          {unread > 0 ? (
            <span className="sh-badge" aria-hidden="true">
              {formatNumber(unread, numberFormat)}
            </span>
          ) : null}
        </button>
      </Tooltip>
      {pop.open
        ? createPortal(
            <>
              <div className="sh-scrim sh-scrim-sheet" aria-hidden="true" />
              <div
                ref={pop.box}
                id={panelId}
                role="dialog"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="sh-pop"
                style={
                  pop.at ? { left: pop.at.left, top: pop.at.top } : { left: 0, top: 0, visibility: 'hidden' }
                }
              >
                <div className="sh-grab" aria-hidden="true" />
                <div className="sh-ph">
                  <h2 id={titleId}>الإشعارات</h2>
                  {unread > 0 ? (
                    <span className="sh-chip">
                      <bdi className="sh-num">{formatNumber(unread, numberFormat)}</bdi>&nbsp;جديدة
                    </span>
                  ) : null}
                  <button type="button" className="sh-mark" disabled={unread === 0} onClick={markAll}>
                    تعليم الكل كمقروء
                  </button>
                </div>
                <div className="sh-seg" role="group" aria-label="عرض الإشعارات">
                  <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>
                    الكل
                  </button>
                  <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>
                    غير المقروءة <span className="sh-num">{formatNumber(unread, numberFormat)}</span>
                  </button>
                </div>
                <div className="sh-nl">
                  {shown.length === 0 ? (
                    <div className="sh-nempty">
                      <span className="sh-tile" aria-hidden="true">
                        {onlyUnread ? <CheckIcon size={24} /> : <NotificationsIcon size={24} />}
                      </span>
                      <strong>{onlyUnread ? 'لا إشعارات غير مقروءة' : 'لا إشعارات جديدة'}</strong>
                      <span>
                        {onlyUnread
                          ? 'قرأت كل ما وصلك.'
                          : 'الطلبات والديون والمخزون التي تنتظرك تراها في الرئيسية.'}
                      </span>
                    </div>
                  ) : (
                    BUCKETS.map(({ key, label: bucket }) => {
                      const group = shown.filter((notice) => bucketOf(notice, clock) === key);
                      if (group.length === 0) return null;
                      return (
                        <section key={key} aria-label={bucket}>
                          <div className="sh-ng" aria-hidden="true">
                            {bucket}
                          </div>
                          {group.map((notice) => {
                            const NoticeIcon = notice.icon;
                            const fresh = isUnread(notice);
                            return (
                              <Link
                                key={notice.key}
                                to={notice.to}
                                className={fresh ? 'sh-ni is-unread' : 'sh-ni'}
                                onClick={() => {
                                  markRead(notice);
                                  pop.setOpen(false);
                                }}
                              >
                                <span className="sh-ni-tile" data-tone={notice.tone} aria-hidden="true">
                                  <NoticeIcon size={20} />
                                </span>
                                <span className="sh-nb">
                                  <span className="sh-nb-ln">
                                    <b>{notice.title}</b>
                                    {notice.at ? (
                                      <time dateTime={notice.at}>{noticeTime(notice.at, clock)}</time>
                                    ) : null}
                                  </span>
                                  {notice.detail ? <p>{notice.detail}</p> : null}
                                </span>
                                {fresh ? (
                                  <>
                                    <span className="sh-dot" aria-hidden="true" />
                                    <span className="sh-sr">غير مقروء</span>
                                  </>
                                ) : null}
                              </Link>
                            );
                          })}
                        </section>
                      );
                    })
                  )}
                </div>
                {notices.length > 0 ? (
                  <div className="sh-pfoot2">
                    <span>{noticeCount(notices.length, total)}</span>
                    <Link to="/" onClick={() => pop.setOpen(false)}>
                      ما ينتظرك في الرئيسية
                      <NextIcon size={16} />
                    </Link>
                  </div>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
