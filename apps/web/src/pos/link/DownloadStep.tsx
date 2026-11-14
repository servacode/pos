import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStore } from '@serva/sync/client';
import { Alert, Button, CheckCircleIcon, cn, ProgressBar, RetryIcon, Spinner } from '@serva/ui';
import type { BootstrapProgress, LinkHelpers } from '../../offline/link';
import { deviceTransport } from '../../offline/sync';

interface DownloadStepProps {
  store: SyncStore;
  helpers: LinkHelpers;
  storeName: string;
  onDone: () => void;
}

const percent = (p: BootstrapProgress) => (p.total > 0 ? Math.floor((p.received / p.total) * 100) : 0);

/**
 * Step 4: the first download of the store's data (15 › التنزيل). The device is already saved, so a
 * reload here opens the login code and the regular pull finishes the job.
 */
export function DownloadStep({ store, helpers, storeName, onDone }: DownloadStepProps) {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    helpers
      .runBootstrap({
        store,
        transport: deviceTransport(store),
        onProgress: (p) => alive && setProgress(p),
      })
      .then(
        () => {
          if (!alive) return;
          setDone(true);
          onDoneRef.current();
        },
        () => alive && setFailed(true),
      );
    return () => {
      alive = false;
    };
  }, [store, helpers, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <section
      aria-labelledby="download-title"
      aria-busy={!done && !failed}
      className="flex w-full max-w-xl flex-col items-center gap-6 rounded-card border border-line bg-surface px-8 py-10 text-center shadow-e2"
    >
      <span
        className={cn(
          'grid size-20 place-items-center rounded-full ring-8',
          done
            ? 'bg-success-soft text-success-ink ring-success-soft/40'
            : 'bg-brand-soft text-brand-ink ring-brand-soft/40',
        )}
      >
        {done ? <CheckCircleIcon size={48} /> : <Spinner className="size-10" />}
      </span>
      <div className="flex flex-col gap-2">
        <h1 id="download-title" className="text-2xl font-bold text-ink">
          {done ? 'هذا الجهاز جاهز للعمل دون إنترنت' : 'جارٍ تنزيل بيانات المحل…'}
        </h1>
        <p className="text-ink-muted">
          رُبط الجهاز بـ«{storeName}». ننزّل الأصناف والأسعار والموظفين مرة واحدة، ويكمل من حيث توقف إن انقطع
          الإنترنت.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <ProgressBar
          label="تنزيل بيانات المحل"
          value={done ? 1 : progress && progress.total > 0 ? progress.received : undefined}
          max={done ? 1 : progress?.total || undefined}
          valueText={done ? 'اكتمل' : progress ? `${percent(progress)}%` : undefined}
          tone={done ? 'success' : 'brand'}
        />
        {progress && progress.total > 0 && !done ? (
          <p className="num self-end text-sm font-semibold text-ink-muted">{percent(progress)}%</p>
        ) : null}
      </div>
      {failed ? (
        <div className="flex w-full flex-col items-center gap-4">
          <Alert tone="error" className="w-full text-start">
            توقف التنزيل. تحقّق من الإنترنت، ثم أكمل من حيث توقف.
          </Alert>
          <Button size="lg" icon={<RetryIcon />} onClick={retry}>
            أكمل التنزيل
          </Button>
        </div>
      ) : null}
    </section>
  );
}
