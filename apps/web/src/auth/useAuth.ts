import { useContext } from 'react';
import type { MeResponse } from '@serva/core';
import { AuthContext, type AuthContextValue } from './AuthContext';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function useMe(): MeResponse {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useMe requires a signed-in user');
  return state.me;
}
