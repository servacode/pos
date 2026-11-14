import 'fake-indexeddb/auto';
import { DirectionProvider } from '@radix-ui/react-direction';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { resetDeviceStore } from '../offline/database';
import { linkedDevice } from '../test/pos';
import { DeviceGate } from './DeviceGate';

afterEach(async () => {
  await resetDeviceStore();
});

function gate(
  load: () => Promise<typeof linkedDevice | null>,
  kind: 'kitchen_screen' | 'waiter' = 'kitchen_screen',
) {
  return render(
    <DirectionProvider dir="rtl">
      <MemoryRouter>
        <DeviceGate kind={kind} load={load}>
          {(device) => (
            <p>
              الجهاز {device.deviceName} · {device.token.slice(0, 4)}
            </p>
          )}
        </DeviceGate>
      </MemoryRouter>
    </DirectionProvider>,
  );
}

describe('linking a kitchen or waiter device', () => {
  it('opens the screen with the device’s token once it is linked', async () => {
    gate(async () => linkedDevice);
    expect(await screen.findByText(/الجهاز الصندوق 2 · sdt_/)).toBeInTheDocument();
  });

  it('shows the linking steps for a device that is not linked, or has no token yet, or cannot be read', async () => {
    gate(async () => null);
    expect(await screen.findByRole('heading', { name: 'هل هذه شاشة المطبخ؟' })).toBeInTheDocument();
  });

  it('treats a device record without a token as not linked, and a failing read as none', async () => {
    const view = gate(async () => ({ ...linkedDevice, token: null }));
    expect(await screen.findByRole('heading', { name: 'هل هذه شاشة المطبخ؟' })).toBeInTheDocument();
    view.unmount();
    gate(async () => {
      throw new Error('no database');
    }, 'waiter');
    expect(await screen.findByRole('heading', { name: 'هل هذا جوال النادل؟' })).toBeInTheDocument();
  });
});
