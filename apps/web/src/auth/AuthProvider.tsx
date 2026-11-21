import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, MeResponse } from '@serva/core';
import {
  apiFetch,
  forgetSession,
  getAccessToken,
  knownSignedOut,
  neverHadSession,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken,
} from '../lib/api';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';
import { clearReportCache } from '../admin/reports/useReport';

function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/v1/me', { auth: true });
}

// The last «me» this tab saw (sessionStorage: gone when the tab closes, wiped at sign-out). A full
// reload starts from it, so the real shell and the last numbers show at once while the session is
// confirmed in the background. A lost session still ends at the login page.
const ME_KEY = 'serva.me';
/** A «me» older than this is read again when the tab comes back (a role or plan changed elsewhere) */
const ME_STALE_MS = 5 * 60_000;

function readKeptMe(): MeResponse | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as MeResponse) : null;
  } catch {
    return null;
  }
}

function keepMe(me: MeResponse | null): void {
  try {
    if (me) globalThis.sessionStorage?.setItem(ME_KEY, JSON.stringify(me));
    else globalThis.sessionStorage?.removeItem(ME_KEY);
  } catch {
    // Storage refused or full: the reload simply waits for the server.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const kept = readKeptMe();
    return kept ? { status: 'signedIn', me: kept } : { status: 'loading' };
  });
  // The first refresh starts while this renders, before any page below asks for data, so the
  // pages' first requests wait for the token instead of being refused and sent again.
  // Coming from another part of the app in the same tab (the till, the shop) the token is still in
  // memory: nothing is asked again. Only a fresh page load (no token yet) asks for one.
  const [boot] = useState(() => {
    const held = getAccessToken();
    if (held) return Promise.resolve(held);
    // This browser was already told «no session»: show the login page without asking again.
    if (knownSignedOut()) return Promise.resolve(null);
    // A first visit, with no session note and no kept «me»: there is nothing to refresh, so no
    // request (and no red 401 line). Signed-in users always have the note or the kept «me».
    if (neverHadSession() && !readKeptMe()) return Promise.resolve(null);
    return refreshAccessToken();
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await boot;
        if (!active) return;
        const me = token ? await fetchMe() : null;
        if (!active) return;
        keepMe(me);
        setState((now) => {
          if (!me) return { status: 'signedOut' };
          // Same answer as the kept one: keep the object, so nothing below asks again
          if (now.status === 'signedIn' && JSON.stringify(now.me) === JSON.stringify(me)) return now;
          return { status: 'signedIn', me };
        });
      } catch {
        // A lost connection while a kept session is on screen leaves it there; the first request
        // that gets a real «no» sends the person to the login page.
        if (active) setState((now) => (now.status === 'signedIn' ? now : { status: 'signedOut' }));
      }
    })();
    return () => {
      active = false;
    };
  }, [boot]);

  useEffect(
    () =>
      onSessionExpired(() => {
        clearReportCache();
        keepMe(null);
        setState({ status: 'signedOut', reason: 'expired' });
      }),
    [],
  );

  // When «me» was last read: a tab left open for hours reads it again when it comes back into focus
  const readAt = useRef(Date.now());

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    readAt.current = Date.now();
    keepMe(me);
    setState({ status: 'signedIn', me });
  }, []);

  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    if (!signedIn) return;
    const again = () => {
      if (document.visibilityState === 'hidden' || Date.now() - readAt.current < ME_STALE_MS) return;
      readAt.current = Date.now();
      fetchMe().then(
        (me) => {
          keepMe(me);
          // The same answer keeps the same object, so nothing below asks again
          setState((now) =>
            now.status === 'signedIn' && JSON.stringify(now.me) === JSON.stringify(me)
              ? now
              : { status: 'signedIn', me },
          );
        },
        // Offline or a hiccup: what is on screen stays; a real «no» ends the session by itself
        () => undefined,
      );
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [signedIn]);

  const startSession = useCallback(
    async (auth: AuthResponse) => {
      clearReportCache();
      setAccessToken(auth.accessToken);
      await refreshMe();
    },
    [refreshMe],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      await startSession(await apiFetch<AuthResponse>('/v1/auth/login', { method: 'POST', body: input }));
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    await apiFetch<void>('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearReportCache();
    keepMe(null);
    forgetSession();
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, refreshMe }),
    [state, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
