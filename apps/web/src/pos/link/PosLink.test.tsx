import 'fake-indexeddb/auto';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceStore, resetDeviceStore } from '../../offline/database';
import type * as LinkModule from '../../offline/link';
import { activatedDevice, fakeLinkHelpers, pendingActivation } from '../../test/devices';
import { mockFetch } from '../../test/fetchMock';
import { renderApp } from '../../test/renderApp';

const helpers = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeLinkHelpers> | null }));

// The cashier reaches the @serva/sync/client helpers through this adapter only.
vi.mock('../../offline/link', async (importOriginal) => {
  const actual = await importOriginal<typeof LinkModule>();
  return {
    ...actual,
    linkHelpers: {
      createDeviceKeys: (...args: Parameters<typeof actual.linkHelpers.createDeviceKeys>) =>
        helpers.current!.createDeviceKeys(...args),
      saveActivatedDevice: (...args: Parameters<typeof actual.linkHelpers.saveActivatedDevice>) =>
        helpers.current!.saveActivatedDevice(...args),
      runBootstrap: (...args: Parameters<typeof actual.linkHelpers.runBootstrap>) =>
        helpers.current!.runBootstrap(...args),
    },
  };
});

const QR_TOKEN = `spq_${'Q'.repeat(22)}`;

afterEach(async () => {
  // Stop the sync loops of the linked device, and let a request in flight end, before the
  // database goes.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await resetDeviceStore();
});

describe('/pos on a new device', () => {
  it('a scanned QR link opens naming; once the owner allows it, the login code opens', async () => {
    helpers.current = fakeLinkHelpers();
    const { requestsTo } = mockFetch({
      'POST /v1/devices/activate': { status: 200, body: pendingActivation() },
      'GET /v1/devices/activations/act-1': {
        status: 200,
        body: { status: 'active', device: activatedDevice },
      },
    });
    const { user } = renderApp(`/link#${QR_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'سمِّ هذا الجهاز' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسم الجهاز'), 'كاشير 3');
    await user.click(screen.getByRole('button', { name: 'اطلب موافقة المالك' }));

    expect(await screen.findByText('لا أسماء موظفين على هذا الجهاز بعد')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/devices/activate')[0]!.body).toMatchObject({
      method: 'qr',
      qrToken: QR_TOKEN,
      name: 'كاشير 3',
    });
    expect(helpers.current.runBootstrap).toHaveBeenCalledOnce();
    expect(await deviceStore().getDevice()).toMatchObject({ deviceCode: '003' });
    // The status bar now names the store, the branch and the device.
    expect(screen.getByText('مقهى الياسمين')).toBeInTheDocument();
    expect(screen.getByText('الرقة · شارع تل أبيض · كاشير 3')).toBeInTheDocument();
  });
});
