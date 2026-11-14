import { useMemo } from 'react';
import { postStaffSession } from '../../pos/staff/staffApi';
import { DeviceGate } from '../DeviceGate';
import { createHallApi } from '../api';
import { WaiterScreen } from './WaiterScreen';

/** `/waiter`: the waiter's screen on a device linked as «جهاز نادل» (03 › وضع النادل). */
export function WaiterApp() {
  return (
    <>
      <title>النادل · SERFA</title>
      <DeviceGate kind="waiter">
        {(device) => <WaiterOnDevice token={device.token} name={device.deviceName} />}
      </DeviceGate>
    </>
  );
}

function WaiterOnDevice({ token, name }: { token: string; name: string }) {
  const api = useMemo(() => createHallApi(token), [token]);
  return (
    <WaiterScreen
      api={api}
      deviceName={name}
      signIn={(userId, pin) => postStaffSession({ userId, pin }, token)}
    />
  );
}
