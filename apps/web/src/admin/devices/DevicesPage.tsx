import { useCallback, useEffect, useState } from 'react';
import type { DeviceSummary } from '@serva/core';
import {
  Alert,
  Button,
  Card,
  DeviceIcon,
  Dialog,
  EmptyState,
  InfoIcon,
  LinkIcon,
  LockIcon,
  RetryIcon,
  SkeletonText,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, errorMessage } from '../../lib/api';
import { documentsCount } from '../../lib/devices';
import { useNow } from '../../lib/useNow';
import { decideDevice, listDevices, renameDevice, type DeviceDecision } from './api';
import { DeviceRow } from './DeviceRow';
import { PairingDialogBody } from './PairingDialog';
import { PendingDevice } from './PendingDevice';

/** While the pairing dialog is open or a device waits for «اسمح», the list is asked again this often. */
export const DEVICES_POLL_MS = 5000;

interface BranchGroup {
  id: string;
  name: string;
  devices: DeviceSummary[];
}

function groupByBranch(devices: DeviceSummary[], branches: { id: string; name: string }[]): BranchGroup[] {
  const groups = new Map<string, BranchGroup>(branches.map((b) => [b.id, { ...b, devices: [] }]));
  for (const device of devices) {
    const group = groups.get(device.branchId);
    if (group) group.devices.push(device);
    else groups.set(device.branchId, { id: device.branchId, name: device.branchName, devices: [device] });
  }
  return [...groups.values()].filter((g) => g.devices.length > 0);
}

/**
 * «الأجهزة» (12, kit admin/BranchesDevices and owner-phone/DeviceApprove): every device by branch
 * with its status, last contact and what has not reached the server; linking a new one; approving,
 * renaming and stopping a device from afar. Works at phone width, since the owner approves there.
 */
export function DevicesPage() {
  const me = useMe();
  const isOwner = me.user.permissions.includes('devices.manage');
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [revoking, setRevoking] = useState<DeviceSummary | null>(null);
  const now = useNow(30_000);

  const refresh = useCallback(async () => {
    try {
      const answer = await listDevices();
      setDevices(answer.devices);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pending = devices?.filter((d) => d.status === 'pending_approval') ?? [];
  const polling = pairing || pending.length > 0;

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void refresh(), DEVICES_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const replace = (updated: DeviceSummary) =>
    setDevices((current) => current?.map((d) => (d.id === updated.id ? updated : d)) ?? current);

  async function decide(device: DeviceSummary, decision: DeviceDecision): Promise<boolean> {
    setBusyId(device.id);
    setActionError(null);
    try {
      replace(await decideDevice(device.id, decision));
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      void refresh();
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function rename(device: DeviceSummary, name: string): Promise<string | null> {
    try {
      replace(await renameDevice(device.id, { name, version: device.version }));
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') {
        void refresh();
        return 'غيّر أحدٌ هذا الجهاز للتو. حدّثنا القائمة، جرّب مرة أخرى.';
      }
      return errorMessage(error);
    }
  }

  const listed = devices?.filter((d) => d.status === 'active' || d.status === 'revoked') ?? [];
  const groups = groupByBranch(listed, me.branches);

  return (
    <AppShell>
      <title>الأجهزة · Serva POS</title>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink">الأجهزة</h1>
            <p className="text-ink-muted">أجهزة الكاشير والجوالات المربوطة بمتجرك، في كل فرع.</p>
          </div>
          {isOwner ? (
            <Button icon={<LinkIcon />} onClick={() => setPairing(true)} className="max-sm:w-full">
              اربط جهازاً جديداً
            </Button>
          ) : null}
        </div>

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {pending.length > 0 ? (
          <section aria-labelledby="pending-title" className="flex flex-col gap-3">
            <h2 id="pending-title" className="text-lg font-semibold text-ink">
              بانتظار موافقتك
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {pending.map((device) => (
                <PendingDevice
                  key={device.id}
                  device={device}
                  busy={busyId === device.id}
                  canDecide={isOwner}
                  onDecide={(decision) => void decide(device, decision)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {devices === null && !loadError ? (
          <Card aria-busy="true">
            <span className="sr-only">نحمّل الأجهزة…</span>
            <SkeletonText lines={4} />
          </Card>
        ) : null}

        {loadError && devices === null ? (
          <Card className="flex flex-col items-start gap-3">
            <Alert tone="error">{loadError}</Alert>
            <Button variant="secondary" icon={<RetryIcon />} onClick={() => void refresh()}>
              أعد المحاولة
            </Button>
          </Card>
        ) : null}

        {devices !== null && groups.length === 0 && pending.length === 0 ? (
          <Card>
            <EmptyState
              icon={DeviceIcon}
              title="لا أجهزة مربوطة بعد."
              description="اربط جهاز الكاشير الأول: يظهر لك رمز تكتبه على الجهاز أو تمسحه بكاميرته."
              action={
                isOwner ? (
                  <Button icon={<LinkIcon />} onClick={() => setPairing(true)}>
                    اربط جهازاً جديداً
                  </Button>
                ) : null
              }
            />
          </Card>
        ) : null}

        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`branch-${group.id}`} className="flex flex-col gap-3">
            <h2 id={`branch-${group.id}`} className="text-lg font-semibold text-ink">
              {group.name}
            </h2>
            <ul className="flex flex-col rounded-card border border-line bg-surface shadow-e1">
              {group.devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  now={now}
                  canManage={isOwner}
                  onRename={rename}
                  onRevoke={setRevoking}
                />
              ))}
            </ul>
          </section>
        ))}

        {groups.length > 0 ? (
          <p className="flex items-start gap-2 text-sm text-ink-muted">
            <InfoIcon className="mt-0.5" />
            الجهاز الموقوف يعرض «أوقف المالك هذا الجهاز»، وما فيه من فواتير لم تصل يُرسل ويُحفظ للمراجعة.
          </p>
        ) : null}
      </div>

      <Dialog
        open={pairing}
        onOpenChange={setPairing}
        title="اربط جهازاً جديداً"
        description="على الجهاز الجديد افتح سيرفا، واختر «هل هذا جهاز كاشير؟»."
        actions={
          <Button variant="secondary" onClick={() => setPairing(false)}>
            تم
          </Button>
        }
      >
        {pairing ? (
          <PairingDialogBody
            branches={me.branches}
            pending={pending}
            busyId={busyId}
            onDecide={(device, decision) => void decide(device, decision)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        size="sm"
        title={revoking ? `أوقف «${revoking.name}» عن بُعد؟` : ''}
        description="يتوقف البيع عليه عند أول اتصال، ولا يعود إلا بربط جديد."
        actions={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              تراجع
            </Button>
            <Button
              variant="danger"
              icon={<LockIcon />}
              loading={revoking !== null && busyId === revoking.id}
              onClick={async () => {
                if (revoking && (await decide(revoking, 'revoke'))) setRevoking(null);
              }}
            >
              أوقف الجهاز
            </Button>
          </>
        }
      >
        {revoking ? <RevokeDetails device={revoking} /> : null}
      </Dialog>
    </AppShell>
  );
}

/** What happens to the documents still on the device (16 › ضياع جهاز الكاشير). */
function RevokeDetails({ device }: { device: DeviceSummary }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-surface-muted px-3 py-2 text-sm text-ink">
      {device.unsentCount ? (
        <span>بانتظار الإرسال على الجهاز: {documentsCount(device.unsentCount)}</span>
      ) : null}
      {device.missingDocuments ? (
        <span>أعلن عنها الجهاز ولم تصل: {documentsCount(device.missingDocuments)}</span>
      ) : null}
      <span>ما يرسله بعد الإيقاف لا يضيع: يُحفظ جانباً لتراجعه قبل أن يدخل الحسابات.</span>
    </div>
  );
}
