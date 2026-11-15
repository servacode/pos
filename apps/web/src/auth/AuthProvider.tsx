import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, MeResponse } from '@serva/core';
import { apiFetch, onSessionExpired, refreshAccessToken, setAccessToken } from '../lib/api';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';
import { clearReportCache } from '../admin/reports/useReport';

function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/v1/me', { auth: true });
}

// The last «me» this tab saw (sessionStorage: gone when the tab closes, wiped at sign-out). A full
// reload starts from it, so the real shell and the last numbers show at once while the session is
// confirmed in the background. A lost session still ends at the login page.
const ME_KEY = 'serva.me';

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
  const [boot] = useState(() => refreshAccessToken());

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

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    keepMe(me);
    setState({ status: 'signedIn', me });
  }, []);

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
    setAccessToken(null);
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, refreshMe }),
    [state, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
