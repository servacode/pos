import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, LoginInput, MeResponse } from '@serva/core';
import { apiFetch, onSessionExpired, refreshAccessToken, setAccessToken } from '../lib/api';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';

function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/v1/me', { auth: true });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await refreshAccessToken();
        if (!active) return;
        const me = token ? await fetchMe() : null;
        if (active) setState(me ? { status: 'signedIn', me } : { status: 'signedOut' });
      } catch {
        if (active) setState({ status: 'signedOut' });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onSessionExpired(() => {
        setState({ status: 'signedOut', reason: 'expired' });
      }),
    [],
  );

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setState({ status: 'signedIn', me });
  }, []);

  const startSession = useCallback(
    async (auth: AuthResponse) => {
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
    setAccessToken(null);
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, refreshMe }),
    [state, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
