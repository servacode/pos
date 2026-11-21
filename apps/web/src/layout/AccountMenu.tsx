import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import {
  CardIcon,
  initialsOf,
  KeyIcon,
  LogoutIcon,
  MoonIcon,
  ShieldCheckIcon,
  Spinner,
  SunIcon,
  SystemThemeIcon,
  Tooltip,
  useThemePreference,
  type Icon,
  type ThemePreference,
} from '@serva/ui';
import { clamp, isRtl, usePopover } from './popover';

const THEMES: readonly { value: ThemePreference; label: string; icon: Icon }[] = [
  { value: 'light', label: 'فاتح', icon: SunIcon },
  { value: 'dark', label: 'داكن', icon: MoonIcon },
  { value: 'system', label: 'تلقائي', icon: SystemThemeIcon },
];

/**
 * The account row of the sidebar's footer and the menu it opens above itself (round 45: the account
 * is no longer an avatar in the top bar). A disclosure of links and buttons: the cashier's code, the
 * subscription for whoever manages it, the terms, the theme, sign out.
 */
export function AccountMenu({
  rail,
  userName,
  roleName,
  phone,
  planName,
  canSeePlan,
  onLogout,
}: {
  /** The sidebar is the rail of icons: the row shows only the avatar, and a hint says who. */
  rail: boolean;
  userName: string;
  roleName: string | undefined;
  phone: string | null;
  planName: string;
  canSeePlan: boolean;
  onLogout: () => Promise<void>;
}) {
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useThemePreference();
  const panelId = useId();
  const pop = usePopover((anchor, box, view) => {
    const left = isRtl() ? anchor.right - box.width : anchor.left;
    return {
      left: clamp(left, 12, Math.max(12, view.width - box.width - 12)),
      top: Math.max(12, anchor.top - box.height - 8),
    };
  });
  const { setOpen } = pop;

  useEffect(() => setOpen(false), [pathname, setOpen]);
  useEffect(() => {
    if (pop.open) pop.box.current?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
  }, [pop.open, pop.box]);

  async function logout() {
    setSigningOut(true);
    try {
      await onLogout();
    } catch {
      // The sign-out did not finish: the item is usable again, not a spinner for ever
      setSigningOut(false);
    }
  }

  const initials = initialsOf(userName);
  const detail = roleName ?? '';
  return (
    <>
      <Tooltip content={rail && !pop.open ? `${userName}${detail ? ` · ${detail}` : ''}` : null} side="end">
        <button
          ref={pop.trigger}
          type="button"
          className="sh-user"
          aria-label={`حسابي: ${userName}`}
          aria-expanded={pop.open}
          aria-controls={pop.open ? panelId : undefined}
          onClick={() => setOpen(!pop.open)}
        >
          <span className="sh-av" aria-hidden="true">
            {initials}
          </span>
          <span className="sh-ut" aria-hidden="true">
            <b>{userName}</b>
            {detail ? <span>{detail}</span> : null}
          </span>
        </button>
      </Tooltip>
      {pop.open
        ? createPortal(
            <div
              ref={pop.box}
              id={panelId}
              role="group"
              aria-label="حسابي"
              className="sh-menu"
              style={
                pop.at ? { left: pop.at.left, top: pop.at.top } : { left: 0, top: 0, visibility: 'hidden' }
              }
            >
              <div className="sh-mh">
                <span className="sh-av" aria-hidden="true">
                  {initials}
                </span>
                <div>
                  <b>{userName}</b>
                  {detail ? <span>{detail}</span> : null}
                  {phone ? <span className="sh-num">{phone}</span> : null}
                </div>
              </div>
              <div className="sh-msep" />
              <Link to="/me/pin" className="sh-mi">
                <KeyIcon size={20} />
                رمز الدخول للكاشير
              </Link>
              {canSeePlan ? (
                <Link to="/subscription" className="sh-mi">
                  <CardIcon size={20} />
                  الاشتراك
                  <span className="sh-chip">{planName}</span>
                </Link>
              ) : null}
              <a href="/terms" target="_blank" rel="noopener" className="sh-mi">
                <ShieldCheckIcon size={20} />
                الشروط والخصوصية
              </a>
              <div className="sh-msep" />
              <div className="sh-themeseg" role="group" aria-label="المظهر">
                {THEMES.map(({ value, label, icon: ThemeIcon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <ThemeIcon size={16} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="sh-msep" />
              <button
                type="button"
                className="sh-mi is-danger"
                disabled={signingOut}
                onClick={() => void logout()}
              >
                {signingOut ? <Spinner /> : <LogoutIcon size={20} />}
                تسجيل الخروج
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
