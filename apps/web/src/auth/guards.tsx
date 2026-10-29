import { Navigate, Outlet } from 'react-router';
import { FullScreenLoader } from '../ui/FullScreenLoader';
import { useAuth } from './useAuth';

export function RequireAuth() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'signedIn') return <Navigate to="/" replace />;
  return <Outlet />;
}
