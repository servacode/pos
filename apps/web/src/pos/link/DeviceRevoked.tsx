import { useState } from 'react';
import { Alert, Button, LinkIcon, WarningIcon } from '@serva/ui';

/**
 * The owner suspended this device (16 › إيقاف جهاز): nobody sells or signs in on it. What it still
 * held is sent first (the server takes a suspended device's documents); once nothing is left, it
 * can forget everything and be linked again, to the same store or another.
 */
export function DeviceRevoked({
  deviceName,
  pending,
  online,
  onForget,
}: {
  deviceName: string | null;
  /** Documents not yet sent; null while unknown */
  pending: number | null;
  online: boolean;
  onForget: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const left = pending ?? 0;

  async function forget() {
    setBusy(true);
    try {
      await onForget();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="revoked-title"
      className="flex w-full max-w-lg flex-col items-center gap-5 rounded-card bg-surface p-8 text-center shadow-e2 ring-1 ring-line"
    >
      <span className="grid size-16 place-items-center rounded-2xl bg-warning-soft text-warning-ink">
        <WarningIcon size={32} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 id="revoked-title" className="text-2xl font-bold text-ink">
          أُوقف هذا الجهاز
        </h1>
        <p className="text-ink-muted">
          أوقف صاحب المتجر {deviceName ? `«${deviceName}»` : 'هذا الجهاز'} من صفحة «الأجهزة»، فلا يبيع ولا
          يدخل عليه أحد.
        </p>
      </div>

      {left > 0 ? (
        <Alert tone="info" className="w-full text-start">
          {`على الجهاز ${left} ${left === 1 ? 'مستند لم يُرسل' : 'مستندات لم تُرسل'} بعد. `}
          {online
            ? 'أعد فتح الصفحة ليُرسلها، ثم اربطه من جديد.'
            : 'صِله بالإنترنت وأعد فتح الصفحة ليُرسلها، ثم اربطه من جديد.'}
        </Alert>
      ) : (
        <p className="text-sm text-ink-muted">كل ما على الجهاز وصل إلى المتجر. يمكنك ربطه من جديد.</p>
      )}

      <div className="flex w-full flex-col gap-2">
        <Button size="lg" fullWidth icon={<LinkIcon />} loading={busy} disabled={left > 0} onClick={forget}>
          اربط هذا الجهاز من جديد
        </Button>
        {left > 0 ? (
          dropping ? (
            <Button variant="danger" fullWidth loading={busy} onClick={forget}>
              تأكيد: احذف {left} {left === 1 ? 'مستنداً' : 'مستندات'} دون إرسال
            </Button>
          ) : (
            <Button variant="ghost" fullWidth onClick={() => setDropping(true)}>
              أعد الربط دون إرسال ما بقي
            </Button>
          )
        ) : null}
      </div>
    </section>
  );
}
