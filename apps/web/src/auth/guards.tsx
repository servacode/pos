import { Navigate, Outlet } from 'react-router';
import { FullScreenLoader } from '@serva/ui';
import { ShellSkeleton } from '../layout/ShellSkeleton';
import { useAuth } from './useAuth';

export function RequireAuth() {
  const { state } = useAuth();
  // The shell's own frame while the session is restored, not a logo splash
  if (state.status === 'loading') return <ShellSkeleton />;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'signedIn') return <Navigate to="/" replace />;
  return <Outlet />;
}
