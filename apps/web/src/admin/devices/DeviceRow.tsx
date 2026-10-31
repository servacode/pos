import { useState, type FormEvent } from 'react';
import { deviceNameSchema, type DeviceKind, type DeviceSummary } from '@serva/core';
import {
  BarcodeIcon,
  Button,
  DeviceIcon,
  EditIcon,
  IconButton,
  LockIcon,
  MonitorIcon,
  PhoneIcon,
  StatusChip,
  TabletIcon,
  TextField,
  type Icon,
  type Status,
} from '@serva/ui';
import { deviceTypeLabel, documentsCount, formatSince } from '../../lib/devices';

export const KIND_ICONS: Record<DeviceKind, Icon> = {
  cashier: DeviceIcon,
  android_pos: TabletIcon,
  rep_phone: PhoneIcon,
  price_checker: BarcodeIcon,
  kitchen_screen: MonitorIcon,
  waiter: PhoneIcon,
  call_screen: MonitorIcon,
};

export const STATUS_CHIPS: Record<DeviceSummary['status'], Status> = {
  pending_approval: 'pendingApproval',
  active: 'active',
  revoked: 'suspended',
  rejected: 'rejected',
};

/** What reached the server from this device, in the glossary's words. */
function sendingState(device: DeviceSummary): { text: string; danger: boolean } {
  if (device.missingDocuments && device.missingDocuments > 0) {
    return { text: `لم يصل: ${documentsCount(device.missingDocuments)}`, danger: true };
  }
  if (device.unsentCount && device.unsentCount > 0) {
    return { text: `${device.unsentCount} بانتظار الإرسال`, danger: false };
  }
  if (device.missingDocuments === 0 || device.unsentCount === 0)
    return { text: 'كل شيء أُرسل', danger: false };
  return { text: 'لم يرسل شيئاً بعد', danger: false };
}

interface DeviceRowProps {
  device: DeviceSummary;
  now: number;
  canManage: boolean;
  onRename: (device: DeviceSummary, name: string) => Promise<string | null>;
  onRevoke: (device: DeviceSummary) => void;
}

/** One device in the list (kit admin/BranchesDevices): wraps to two lines on a phone. */
export function DeviceRow({ device, now, canManage, onRename, onRevoke }: DeviceRowProps) {
  const KindIcon = KIND_ICONS[device.kind];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const sending = sendingState(device);
  const revoked = device.status === 'revoked';

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = deviceNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    if (parsed.data === device.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const failure = await onRename(device, parsed.data);
    setSaving(false);
    if (failure) setError(failure);
    else setEditing(false);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
      <span
        className={
          revoked
            ? 'grid size-10 shrink-0 place-items-center rounded-control bg-danger-soft text-danger-ink'
            : 'grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-ink'
        }
      >
        <KindIcon />
      </span>

      {editing ? (
        <form noValidate onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
          <TextField
            label={`الاسم الجديد لـ«${device.name}»`}
            hideLabel
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            error={error}
            className="min-w-48 flex-1"
          />
          <Button type="submit" loading={saving}>
            احفظ
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(device.name);
              setError(undefined);
            }}
          >
            تراجع
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1">
            <span className="truncate font-semibold text-ink">{device.name}</span>
            {canManage && !revoked ? (
              <IconButton
                label={`غيّر اسم «${device.name}»`}
                icon={<EditIcon size={16} />}
                onClick={() => setEditing(true)}
              />
            ) : null}
          </span>
          <span className="text-xs text-ink-muted">
            {device.code ? (
              <>
                رمز <bdi className="num">{device.code}</bdi> ·{' '}
              </>
            ) : null}
            {deviceTypeLabel(device.kind, device.platform)}
            {device.appVersion ? (
              <>
                {' '}
                · نسخة <bdi className="num">{device.appVersion}</bdi>
              </>
            ) : null}
          </span>
        </div>
      )}

      <div className="flex flex-col items-start gap-1 text-sm sm:min-w-44">
        <StatusChip status={STATUS_CHIPS[device.status]} />
        <span className="text-ink-muted">
          {revoked && device.revokedAt
            ? `أُوقف ${formatSince(device.revokedAt, now)}`
            : device.lastSeenAt
              ? `آخر اتصال ${formatSince(device.lastSeenAt, now)}`
              : 'لم يتصل بعد'}
        </span>
      </div>

      <p
        className={
          sending.danger
            ? 'text-sm font-semibold text-danger-ink sm:min-w-40'
            : 'text-sm text-ink sm:min-w-40'
        }
      >
        {sending.text}
      </p>

      {canManage && device.status === 'active' ? (
        <Button
          variant="danger-soft"
          size="sm"
          icon={<LockIcon size={16} />}
          onClick={() => onRevoke(device)}
          aria-label={`أوقف عن بُعد: ${device.name}`}
          className="min-h-12 sm:min-h-10"
        >
          أوقف عن بُعد
        </Button>
      ) : null}
    </li>
  );
}
