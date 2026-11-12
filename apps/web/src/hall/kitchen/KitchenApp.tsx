import { useMemo } from 'react';
import { DeviceGate } from '../DeviceGate';
import { createHallApi } from '../api';
import { KitchenScreen } from './KitchenScreen';

/** `/kitchen`: the kitchen screen of a device linked as «شاشة مطبخ» (03 › المطاعم). */
export function KitchenApp() {
  return (
    <>
      <title>المطبخ · SERFA</title>
      <DeviceGate kind="kitchen_screen">
        {(device) => <KitchenOnDevice token={device.token} name={device.deviceName} />}
      </DeviceGate>
    </>
  );
}

function KitchenOnDevice({ token, name }: { token: string; name: string }) {
  const api = useMemo(() => createHallApi(token), [token]);
  return <KitchenScreen api={api} deviceName={name} />;
}
