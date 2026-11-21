import type { ReactElement } from 'react';
import { Link } from 'react-router';
import {
  CloseIcon,
  Logo,
  LogoMark,
  NextIcon,
  SparklesIcon,
  InfoIcon,
  Tooltip,
  type FloatingSide,
} from '@serva/ui';
import { AccountMenu } from './AccountMenu';
import type { NavGroupKey, NavSection } from './nav';

/** A counter on a menu link: «waiting» is for you to act on (filled), the rest is information (quiet). */
export interface NavCount {
  value: string;
  /** The words a screen reader adds: «3 طلبات بانتظارك». */
  words: string;
  waiting: boolean;
}

export interface SidebarStore {
  name: string;
  initials: string;
  /** The plan chip: «تجربة», «أساسية»… */
  chip: string;
  /** «3 فروع», or null for a store with one branch. */
  branches: string | null;
}

export interface SidebarPlan {
  name: string;
  trial: { daysText: string; days: number; total: number } | null;
  /** The trial is about to end: the card turns to a warning colour and a word, never colour alone. */
  urgent: boolean;
  canManage: boolean;
}

export interface SidebarAccount {
  userName: string;
  roleName: string | undefined;
  phone: string | null;
  canSeePlan: boolean;
  onLogout: () => Promise<void>;
}

const HINT_SIDE: FloatingSide = 'end';

/** On the rail a link's words show in a hint, on hover and on keyboard focus. */
function Hint({ rail, text, children }: { rail: boolean; text: string; children: ReactElement }) {
  return (
    <Tooltip content={rail ? text : null} side={HINT_SIDE}>
      {children}
    </Tooltip>
  );
}

function TrialRing({ days, total }: { days: number; total: number }) {
  const length = 2 * Math.PI * 17;
  const share = Math.max(0.04, Math.min(1, days / total));
  return (
    <>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-sidebar-line)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(length * share).toFixed(1)} 200`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <b className="sh-num" aria-hidden="true">
        {days}
      </b>
    </>
  );
}

/**
 * The sidebar's panel (هوية 4, round 45): the store card, the menu in titled groups with an active
 * marker and counters, and a footer with ONE plan or trial card, the account row and help. The same
 * panel is drawn on the page's side (full or as the rail of icons) and inside the drawer.
 */
export function SidebarPanel({
  mode,
  rail,
  store,
  groups,
  current,
  counts,
  plan,
  account,
  onClose,
}: {
  mode: 'side' | 'drawer';
  rail: boolean;
  store: SidebarStore;
  groups: { key: NavGroupKey; label?: string; sections: NavSection[] }[];
  current: NavSection | undefined;
  counts: Partial<Record<NavSection['key'], NavCount>>;
  plan: SidebarPlan;
  account: SidebarAccount;
  onClose?: () => void;
}) {
  const trialLabel = plan.trial
    ? `تجربة مجانية، ${plan.trial.daysText}${plan.canManage ? '. إدارة الاشتراك' : ''}`
    : '';
  return (
    <div className="sh-panel">
      <div className="sh-head">
        <div className="sh-wm">
          <Link to="/" className="sh-wm-link" aria-label="سيرفا، الرئيسية">
            {rail ? <LogoMark tone="sidebar" /> : <Logo tone="sidebar" className="h-20" />}
          </Link>
          {mode === 'drawer' ? (
            <button type="button" className="sh-sbbtn sh-close" aria-label="أغلق القائمة" onClick={onClose}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
        <Hint rail={rail} text={store.name}>
          <div className="sh-switch" role="group" aria-label={`المتجر: ${store.name}`}>
            <span className="sh-sav" aria-hidden="true">
              {store.initials}
            </span>
            <span className="sh-sw-t">
              <b>{store.name}</b>
              <span className="sh-sw-s">
                <span className="sh-chip">{store.chip}</span>
                {store.branches ? <span>{store.branches}</span> : null}
              </span>
            </span>
          </div>
        </Hint>
      </div>

      <nav aria-label="القائمة الرئيسية" className="sh-nav">
        {groups.map((group) => (
          <div key={group.key} className="sh-grp">
            {group.label ? (
              <p id={`sh-${mode}-${group.key}`} className="sh-gl">
                {group.label}
              </p>
            ) : null}
            <ul className="sh-list" aria-labelledby={group.label ? `sh-${mode}-${group.key}` : undefined}>
              {group.sections.map((section) => {
                const SectionIcon = section.icon;
                const count = counts[section.key];
                return (
                  <li key={section.key}>
                    <Hint rail={rail} text={count ? `${section.label} · ${count.value}` : section.label}>
                      <Link
                        to={section.pages[0]!.to}
                        className="sh-it"
                        aria-current={section === current ? 'page' : undefined}
                        aria-label={count ? `${section.label}، ${count.words}` : undefined}
                      >
                        <span className="sh-it-i" aria-hidden="true">
                          <SectionIcon size={20} />
                        </span>
                        <span className="sh-t">{section.label}</span>
                        {count ? (
                          <span className={count.waiting ? 'sh-cnt is-hot' : 'sh-cnt'} aria-hidden="true">
                            {count.value}
                          </span>
                        ) : null}
                      </Link>
                    </Hint>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sh-foot">
        {rail ? (
          plan.trial ? (
            <Hint rail text={`تجربة: ${plan.trial.daysText}`}>
              {plan.canManage ? (
                <Link
                  to="/subscription"
                  className={plan.urgent ? 'sh-ring is-warn' : 'sh-ring'}
                  aria-label={trialLabel}
                >
                  <TrialRing days={plan.trial.days} total={plan.trial.total} />
                </Link>
              ) : (
                <div
                  className={plan.urgent ? 'sh-ring is-warn' : 'sh-ring'}
                  role="img"
                  aria-label={trialLabel}
                >
                  <TrialRing days={plan.trial.days} total={plan.trial.total} />
                </div>
              )}
            </Hint>
          ) : plan.canManage ? (
            <Hint rail text={`باقتك: ${plan.name}`}>
              <Link to="/subscription" className="sh-sbbtn" aria-label={`باقتك: ${plan.name}`}>
                <SparklesIcon />
              </Link>
            </Hint>
          ) : null
        ) : plan.canManage ? (
          // Whoever cannot act on the plan is not shown its card
          <PlanCard plan={plan} label={trialLabel} />
        ) : null}
        <div className="sh-urow">
          <AccountMenu
            rail={rail}
            userName={account.userName}
            roleName={account.roleName}
            phone={account.phone}
            planName={plan.name}
            canSeePlan={account.canSeePlan}
            onLogout={account.onLogout}
          />
          <Hint rail={rail} text="المساعدة">
            <a
              href="/terms"
              target="_blank"
              rel="noopener"
              className="sh-sbbtn"
              aria-label="المساعدة والشروط"
            >
              <InfoIcon />
            </a>
          </Hint>
        </div>
      </div>
    </div>
  );
}

/** ONE card for the plan: the days left and a bar while on trial, the plan's name otherwise. */
function PlanCard({ plan, label }: { plan: SidebarPlan; label: string }) {
  const { trial } = plan;
  const body = trial ? (
    <>
      <div className="sh-trial-r1">
        <SparklesIcon size={16} className="sh-trial-sp" />
        <b>تجربة مجانية</b>
        <span className="sh-trial-end">{plan.urgent ? `ستنتهي: ${trial.daysText}` : trial.daysText}</span>
        {plan.canManage ? <NextIcon size={16} /> : null}
      </div>
      <div className="sh-trial-bar" aria-hidden="true">
        <i
          style={{
            width: `${String(Math.max(4, Math.min(100, Math.round((trial.days / trial.total) * 100))))}%`,
          }}
        />
      </div>
    </>
  ) : (
    <div className="sh-trial-r1">
      <SparklesIcon size={16} className="sh-trial-sp" />
      <span>باقتك</span>
      <b>{plan.name}</b>
      {plan.canManage ? <span className="sh-trial-end">إدارة الاشتراك</span> : null}
      {plan.canManage ? <NextIcon size={16} /> : null}
    </div>
  );
  const className = plan.urgent ? 'sh-trial is-warn' : 'sh-trial';
  return plan.canManage ? (
    <Link
      to="/subscription"
      className={className}
      aria-label={trial ? label : `باقتك: ${plan.name}. إدارة الاشتراك`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
