import { useEffect, useRef, useState } from 'react';
import { ACTIVATION_TTL_SECONDS, type ActivatedDevice, type DeviceKind } from '@serva/core';
import {
  AlertCircleIcon,
  Banner,
  Button,
  ClockIcon,
  PhoneIcon,
  ProgressBar,
  RetryIcon,
  UserIcon,
} from '@serva/ui';
import { ApiError } from '../../lib/api';
import {
  DEVICE_KIND_LABELS,
  DEVICE_PLATFORM_LABELS,
  formatCountdown,
  formatPairingCode,
} from '../../lib/devices';
import { useNow } from '../../lib/useNow';
import type { SavedLink } from '../../offline/link';
import { SummaryRow } from '../FlowParts';
import { activationStatus } from './api';

type Waiting = 'pending' | 'rejected' | 'expired';

interface WaitingStepProps {
  link: SavedLink;
  onActive: (device: ActivatedDevice) => void;
  /** Back to step 1 (the request is forgotten on this device) */
  onRestart: (method?: 'owner') => void;
  /** What the device is for; a till unless the kitchen or waiter screen is linking */
  kind?: DeviceKind;
}

const MIN_POLL_MS = 2000;
const time = new Intl.DateTimeFormat('ar-u-nu-latn', { hour: 'numeric', minute: '2-digit' });

/**
 * Step 3 «بانتظار موافقة المالك من جواله». Asks the server every `pollAfterSeconds` with the
 * activation secret; keeps waiting through a lost connection, and stops on «ارفض» or expiry.
 */
export function WaitingStep({ link, onActive, onRestart, kind = 'cashier' }: WaitingStepProps) {
  const [state, setState] = useState<Waiting>('pending');
  const [offline, setOffline] = useState(false);
  const [expiresAt, setExpiresAt] = useState(link.expiresAt);
  const now = useNow(1000, state === 'pending');
  const left = Date.parse(expiresAt) - now;
  const timedOut = state === 'pending' && left <= 0;
  const onActiveRef = useRef(onActive);
  useEffect(() => {
    onActiveRef.current = onActive;
  }, [onActive]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (seconds: number) => {
      if (alive) timer = setTimeout(() => void poll(), Math.max(MIN_POLL_MS, seconds * 1000));
    };

    let deadline = Date.parse(link.expiresAt);

    async function poll() {
      if (Date.now() >= deadline) {
        setState('expired');
        return;
      }
      try {
        const answer = await activationStatus(link.activationId, link.activationSecret);
        if (!alive) return;
        setOffline(false);
        if (answer.status === 'active') onActiveRef.current(answer.device);
        else if (answer.status === 'pending_approval') {
          setExpiresAt(answer.expiresAt);
          deadline = Date.parse(answer.expiresAt);
          // Past its time the request cannot be approved any more: stop asking.
          if (deadline <= Date.now()) setState('expired');
          else wait(answer.pollAfterSeconds);
        } else setState(answer.status);
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && error.code === 'network_error') {
          setOffline(true);
          wait(link.pollAfterSeconds);
        } else if (error instanceof ApiError && error.status >= 500) {
          wait(link.pollAfterSeconds);
        } else {
          // 401, 404 or 410: this request is gone (answered already, or the secret no longer works).
          setState('expired');
        }
      }
    }

    // Ask at once: after a reload the owner may have answered already.
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [link]);

  const shown: Waiting = timedOut ? 'expired' : state;

  if (shown !== 'pending') {
    const rejected = shown === 'rejected';
    return (
      <section
        aria-labelledby="link-ended-title"
        className="flex w-full max-w-xl flex-col items-center gap-5 rounded-card border border-line bg-surface px-8 py-10 text-center shadow-e2"
      >
        <span className="grid size-20 place-items-center rounded-full bg-danger-soft text-danger-ink ring-8 ring-danger-soft/40">
          <AlertCircleIcon size={48} />
        </span>
        <div className="flex flex-col gap-2">
          <h1 id="link-ended-title" className="text-2xl font-bold text-ink">
            {rejected ? 'رفض المالك ربط هذا الجهاز' : 'انتهت مهلة الطلب'}
          </h1>
          <p className="text-ink-muted">
            {rejected
              ? 'إن كان الرفض خطأً، اطلب من المالك رمزاً جديداً وابدأ من جديد.'
              : 'لم يصل رد المالك خلال 10 دقائق. اطلب رمزاً جديداً من الإدارة وابدأ من جديد.'}
          </p>
        </div>
        <Button size="lg" icon={<RetryIcon />} onClick={() => onRestart()}>
          ابدأ من جديد
        </Button>
      </section>
    );
  }

  const rows: [string, string][] = [
    ['اسم الجهاز', link.deviceName],
    ['نوع الجهاز', `${DEVICE_KIND_LABELS[kind]} · ${DEVICE_PLATFORM_LABELS.browser}`],
    ['الفرع', link.branchName],
    [
      'طريقة الربط',
      link.method === 'code' && link.manualCode
        ? `رمز الربط ${formatPairingCode(link.manualCode)}`
        : 'رمز QR',
    ],
    ['وقت الطلب', time.format(new Date(link.requestedAt))],
  ];

  return (
    <section
      aria-labelledby="waiting-title"
      className="grid w-full max-w-5xl grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-5">
          <span className="relative grid size-24 shrink-0 place-items-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-brand-soft motion-safe:animate-skeleton"
            />
            <span className="relative grid size-16 place-items-center rounded-full bg-brand text-on-brand shadow-e2">
              <PhoneIcon size={32} />
            </span>
          </span>
          <div className="flex flex-col gap-2">
            <h1 id="waiting-title" className="text-3xl/tight font-bold text-ink">
              بانتظار موافقة المالك من جواله
            </h1>
            <p className="text-lg text-ink-muted">
              أرسلنا الطلب إلى جوال مالك «{link.storeName}». حين يضغط «اسمح» يبدأ التنزيل وحده.
            </p>
          </div>
        </div>

        {offline ? (
          <Banner tone="offline">انقطع الإنترنت. الطلب محفوظ، ونكمل الانتظار حين يعود الاتصال.</Banner>
        ) : null}

        <dl className="flex flex-col rounded-card border border-line bg-surface px-6 py-1 shadow-e1">
          {rows.map(([label, value]) => (
            <SummaryRow key={label} label={label}>
              <bdi>{value}</bdi>
            </SummaryRow>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-e1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink-muted">
            <ClockIcon />
            ينتهي الطلب بعد{' '}
            <span className="num ms-auto text-kpi font-bold text-ink">{formatCountdown(left)}</span>
          </p>
          <ProgressBar
            label="الوقت الباقي للموافقة"
            value={Math.max(0, left)}
            max={ACTIVATION_TTL_SECONDS * 1000}
            valueText={`${formatCountdown(left)} دقيقة باقية`}
            tone="warning"
          />
          <p className="text-xs text-ink-subtle">
            الطلب صالح {ACTIVATION_TTL_SECONDS / 60} دقيقة. بعدها اطلب رمزاً جديداً من الإدارة.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            icon={<UserIcon />}
            onClick={() => onRestart('owner')}
          >
            المالك هنا؟ ادخل بحسابه
          </Button>
          <Button variant="ghost" size="lg" fullWidth onClick={() => onRestart()}>
            ألغِ الربط
          </Button>
        </div>
      </div>
    </section>
  );
}
