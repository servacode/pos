import { Link } from 'react-router';
import { EmptyState, SearchIcon } from '@serva/ui';
import { AppShell } from '../layout/AppShell';

/** An address the app does not have: a plain answer and the way back, instead of a silent home. */
export function NotFoundPage() {
  return (
    <AppShell>
      <EmptyState
        icon={SearchIcon}
        title="الصفحة غير موجودة"
        description="الرابط الذي فتحته غير صحيح أو لم يعد موجوداً."
        action={
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover pointer-coarse:min-h-12"
          >
            الصفحة الرئيسية
          </Link>
        }
      />
    </AppShell>
  );
}
