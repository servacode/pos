import { useEffect, useState } from 'react';
import type { PlatformEnrolDone, PlatformEnrolStart } from '@serva/core';
import { Alert, Button, Skeleton, TextField } from '@serva/ui';
import { QrCode } from '../admin/devices/QrCode';
import { errorMessage } from '../lib/api';

/**
 * Switching two-factor on, as one block used both inside the sign-in (when the server requires it)
 * and in the panel's security part: the QR code to scan, the same key to type by hand, a code from
 * the authenticator to confirm, then the recovery codes, shown once.
 */
export function TwoFactorEnrol({
  begin,
  confirm,
  onFinished,
  finishLabel,
}: {
  /** Asks the server for a new secret */
  begin: () => Promise<PlatformEnrolStart>;
  /** Confirms it with a code from the authenticator */
  confirm: (code: string) => Promise<PlatformEnrolDone>;
  onFinished: (done: PlatformEnrolDone) => void;
  finishLabel: string;
}) {
  const [start, setStart] = useState<PlatformEnrolStart | null>(null);
  const [done, setDone] = useState<PlatformEnrolDone | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    begin().then(
      (s) => live && setStart(s),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // The secret is requested once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="success">فُعّل التحقق بخطوتين.</Alert>
        <div>
          <h2 className="text-lg font-bold text-ink">رموز الاسترداد</h2>
          <p className="mt-1 text-sm text-ink-muted">
            احفظها الآن في مكان آمن. يعمل كل رمز مرة واحدة إن ضاع جوالك، ولن تظهر هذه الرموز مرة أخرى.
          </p>
          <ul
            dir="ltr"
            aria-label="رموز الاسترداد"
            className="mt-3 grid grid-cols-2 gap-2 rounded-card border border-line bg-surface-sunken p-3 font-mono text-sm text-ink"
          >
            {done.recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          حفظت الرموز
        </label>
        <Button size="lg" fullWidth disabled={!saved} onClick={() => onFinished(done)}>
          {finishLabel}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        confirm(code)
          .then(setDone)
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-muted">
        <li>افتح تطبيق المصادقة في جوالك (Google Authenticator أو Authy أو غيرهما).</li>
        <li>امسح الرمز المربع، أو اكتب المفتاح بيدك.</li>
        <li>اكتب الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.</li>
      </ol>
      {start ? (
        <>
          <QrCode value={start.uri} label="رمز QR لتطبيق المصادقة" className="mx-auto size-48 rounded-card" />
          <div>
            <p className="text-sm font-semibold text-ink-muted">المفتاح لإدخاله يدوياً</p>
            <p
              dir="ltr"
              className="mt-1 select-all rounded-control bg-surface-sunken px-3 py-2 font-mono text-sm"
            >
              {start.secret}
            </p>
          </div>
        </>
      ) : error ? null : (
        <Skeleton className="mx-auto size-48" />
      )}
      <TextField
        label="رمز التطبيق"
        dir="ltr"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" size="lg" fullWidth loading={busy} disabled={!start}>
        تأكيد وتفعيل
      </Button>
    </form>
  );
}
