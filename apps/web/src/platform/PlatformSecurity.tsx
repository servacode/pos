import { useEffect, useState } from 'react';
import type { PlatformEnrolDone, PlatformEnrolStart, PlatformTwoFactorStatus } from '@serva/core';
import { Alert, Button, Card, CardHeader, Skeleton } from '@serva/ui';
import { errorMessage } from '../lib/api';
import { TwoFactorEnrol } from './TwoFactorEnrol';

type Call = <T>(path: string, init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }) => Promise<T>;

/** The panel's security part: whether two-factor sign-in is on, and switching it on. */
export function PlatformSecurity({ call }: { call: Call }) {
  const [status, setStatus] = useState<PlatformTwoFactorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    call<PlatformTwoFactorStatus>('/v1/platform/2fa').then(setStatus, (e: unknown) =>
      setError(errorMessage(e)),
    );
  }, [call]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!status) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardHeader
        title="التحقق بخطوتين"
        description="يُطلب رمز من تطبيق المصادقة في جوالك مع كلمة السر عند كل دخول."
      />
      {enrolling ? (
        <TwoFactorEnrol
          begin={() => call<PlatformEnrolStart>('/v1/platform/2fa/enrol', { method: 'POST', body: {} })}
          confirm={(code) =>
            call<PlatformEnrolDone>('/v1/platform/2fa/enrol/confirm', { method: 'POST', body: { code } })
          }
          onFinished={() => {
            setEnrolling(false);
            setStatus({ ...status, enabled: true, recoveryCodesLeft: 10 });
          }}
          finishLabel="تم"
        />
      ) : status.enabled ? (
        <p className="text-ink">
          مفعّل. بقي لديك <span className="num">{status.recoveryCodesLeft}</span> من رموز الاسترداد.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert tone={status.required ? 'error' : 'info'}>
            {status.required ? 'غير مفعّل، والمنصة تشترطه.' : 'غير مفعّل. ننصح بتفعيله.'}
          </Alert>
          <Button onClick={() => setEnrolling(true)}>فعّل التحقق بخطوتين</Button>
        </div>
      )}
    </Card>
  );
}
