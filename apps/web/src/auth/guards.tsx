import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullScreenLoader } from '@serva/ui';
import { mayOpen } from '../layout/nav';
import { ShellSkeleton } from '../layout/ShellSkeleton';
import { useAuth } from './useAuth';

const NoPermissionPage = lazy(() => import('../pages/NoPermissionPage'));

export function RequireAuth() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  // The shell's own frame while the session is restored, not a logo splash
  if (state.status === 'loading') return <ShellSkeleton />;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  // A page of the menu that this user holds no permission for: said in words before the page asks the server
  if (!mayOpen(state.me, pathname))
    return (
      <Suspense fallback={<ShellSkeleton />}>
        <NoPermissionPage />
      </Suspense>
    );
  return <Outlet />;
}

export function GuestOnly() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'signedIn') return <Navigate to="/" replace />;
  return <Outlet />;
}
