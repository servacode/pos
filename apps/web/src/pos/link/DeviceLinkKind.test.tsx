import 'fake-indexeddb/auto';
import { DirectionProvider } from '@radix-ui/react-direction';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DensityProvider } from '@serva/ui';
import { resetDeviceStore } from '../../offline/database';
import { fakeLinkHelpers, pendingActivation } from '../../test/devices';
import { mockFetch } from '../../test/fetchMock';
import { DeviceLink } from './DeviceLink';

afterEach(async () => {
  vi.useRealTimers();
  await resetDeviceStore();
});

describe('linking a kitchen screen or a waiter’s phone', () => {
  it('asks the owner for the kind this device is, and names it', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/devices/activate': { status: 200, body: pendingActivation() },
      'GET /v1/devices/activations/act-1': { status: 200, body: pendingActivation() },
    });
    const user = userEvent.setup();
    render(
      <DirectionProvider dir="rtl">
        <DensityProvider density="touch">
          <MemoryRouter initialEntries={['/kitchen']}>
            <DeviceLink onLinked={vi.fn()} helpers={fakeLinkHelpers()} kind="kitchen_screen" />
          </MemoryRouter>
        </DensityProvider>
      </DirectionProvider>,
    );
    await user.type(await screen.findByLabelText('رمز المتجر'), '482130');
    await user.type(screen.getByLabelText('رمز الربط (8 خانات)'), 'k7qm4tzp');
    await user.click(screen.getByRole('button', { name: 'التالي: سمِّ الجهاز' }));
    expect(await screen.findByText('شاشة المطبخ · متصفح')).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسم الجهاز'), 'مطبخ المشاوي');
    await user.click(screen.getByRole('button', { name: 'اطلب موافقة المالك' }));
    expect(
      await screen.findByRole('heading', { name: 'بانتظار موافقة المالك من جواله' }),
    ).toBeInTheDocument();
    expect(screen.getByText('شاشة المطبخ · متصفح')).toBeInTheDocument();
    const [activate] = requestsTo('POST', '/v1/devices/activate');
    expect(activate!.body).toMatchObject({ kind: 'kitchen_screen', name: 'مطبخ المشاوي' });
  });
});
