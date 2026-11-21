import { Link } from 'react-router';
import { EmptyState, ShieldCheckIcon } from '@serva/ui';
import { AppShell } from '../layout/AppShell';

/** An address the signed-in user has no right to open: a plain answer and the way back, not a failed page. */
export default function NoPermissionPage() {
  return (
    <AppShell>
      <EmptyState
        icon={ShieldCheckIcon}
        title="ليس لديك صلاحية لهذه الصفحة"
        description="اطلب من صاحب المتجر أن يمنحك هذه الصلاحية، أو ارجع إلى الصفحة الرئيسية."
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
