import { useState, type FormEvent } from 'react';
import { deviceNameSchema, type DeviceKind, type DeviceSummary } from '@serva/core';
import {
  AlertCircleIcon,
  BarcodeIcon,
  Button,
  CheckCircleIcon,
  ClockIcon,
  cn,
  DeviceIcon,
  EditIcon,
  IconButton,
  LockIcon,
  Menu,
  MenuItem,
  MenuSeparator,
  MonitorIcon,
  MoreIcon,
  PhoneIcon,
  SendIcon,
  StatusChip,
  TabletIcon,
  TextField,
  Tooltip,
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

/** What reached the server from this device, in the glossary's words, and its icon. */
function sendingState(device: DeviceSummary): { text: string; danger: boolean; icon: Icon } {
  if (device.missingDocuments && device.missingDocuments > 0) {
    return {
      text: `لم يصل: ${documentsCount(device.missingDocuments)}`,
      danger: true,
      icon: AlertCircleIcon,
    };
  }
  if (device.unsentCount && device.unsentCount > 0) {
    return { text: `${device.unsentCount} بانتظار الإرسال`, danger: false, icon: SendIcon };
  }
  if (device.missingDocuments === 0 || device.unsentCount === 0)
    return { text: 'كل شيء أُرسل', danger: false, icon: CheckCircleIcon };
  return { text: 'لم يرسل شيئاً بعد', danger: false, icon: SendIcon };
}

interface DeviceRowProps {
  device: DeviceSummary;
  now: number;
  canManage: boolean;
  onRename: (device: DeviceSummary, name: string) => Promise<string | null>;
  onRevoke: (device: DeviceSummary) => void;
}

/**
 * One device as a card (kit admin/BranchesDevices; هوية 4 › Card): its kind in a tile, its name and
 * what it is, its status, when it last made contact and what has not reached the server. The
 * owner's actions (rename, stop from afar) are in its menu; renaming opens in place.
 */
export function DeviceRow({ device, now, canManage, onRename, onRevoke }: DeviceRowProps) {
  const KindIcon = KIND_ICONS[device.kind];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const sending = sendingState(device);
  const revoked = device.status === 'revoked';
  const SendingIcon = sending.icon;
  const actions = canManage && device.status === 'active';

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
    <li
      className={cn(
        'flex flex-col rounded-card border border-line shadow-e1',
        revoked ? 'bg-surface-muted/40' : 'bg-surface',
      )}
    >
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-control',
            revoked ? 'bg-danger-soft text-danger-ink' : 'bg-brand-soft text-brand-ink',
          )}
        >
          <KindIcon />
        </span>

        {editing ? (
          <form noValidate onSubmit={save} className="flex min-w-0 flex-1 flex-col gap-2">
            <TextField
              label={`الاسم الجديد لـ«${device.name}»`}
              hideLabel
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError(undefined);
              }}
              error={error}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={saving}>
                احفظ
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setName(device.name);
                  setError(undefined);
                }}
              >
                تراجع
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-semibold text-ink">{device.name}</span>
              <StatusChip status={STATUS_CHIPS[device.status]} className="ms-auto" />
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

        {actions && !editing ? (
          <Menu
            label={`إجراءات «${device.name}»`}
            align="end"
            trigger={
              <Tooltip content="إجراءات الجهاز">
                <IconButton
                  label={`إجراءات «${device.name}»`}
                  icon={<MoreIcon />}
                  size="sm"
                  className="-me-1.5 -mt-1"
                />
              </Tooltip>
            }
          >
            <MenuItem icon={<EditIcon />} onSelect={() => setEditing(true)}>
              غيّر اسم <bdi className="text-ink-muted">«{device.name}»</bdi>
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<LockIcon />}
              tone="danger"
              onSelect={() => onRevoke(device)}
              render={(props) => (
                <button type="button" {...props} aria-label={`أوقف عن بُعد: ${device.name}`} />
              )}
            >
              أوقف عن بُعد
            </MenuItem>
          </Menu>
        ) : null}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line px-4 py-3 text-sm sm:px-5">
        <p className="flex min-w-0 items-center gap-2 text-ink-muted">
          <ClockIcon size={16} className="text-ink-subtle" />
          <span className="min-w-0">
            {revoked && device.revokedAt
              ? `أُوقف ${formatSince(device.revokedAt, now)}`
              : device.lastSeenAt
                ? `آخر اتصال ${formatSince(device.lastSeenAt, now)}`
                : 'لم يتصل بعد'}
          </span>
        </p>
        <p
          className={cn(
            'flex min-w-0 items-center gap-2',
            sending.danger ? 'font-semibold text-danger-ink' : 'text-ink-muted',
          )}
        >
          <SendingIcon size={16} className={sending.danger ? undefined : 'text-ink-subtle'} />
          {sending.text}
        </p>
      </div>
    </li>
  );
}
