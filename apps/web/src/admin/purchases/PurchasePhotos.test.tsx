import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseAttachment } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { PurchasePhotos } from './PurchasePhotos';

/** Round 62: the invoice photo is private, so it is fetched with the token and shown from a local object URL. */

const photos: PurchaseAttachment[] = [
  {
    id: 'a-1',
    url: '/v1/purchases/p-1/attachments/a-1',
    thumbUrl: '/v1/purchases/p-1/attachments/a-1?size=thumb',
  },
];

afterEach(() => vi.unstubAllGlobals());

function stubUrls() {
  const create = vi.fn(() => `blob:photo-${create.mock.calls.length}`);
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
}

describe('PurchasePhotos', () => {
  it('loads each thumbnail with a fetch (never the bare path in an img) and releases it on unmount', async () => {
    const { create, revoke } = stubUrls();
    const { requestsTo } = mockFetch({
      'GET /v1/purchases/p-1/attachments/a-1?size=thumb': { status: 200, body: 'x' },
    });
    const { unmount } = render(
      <PurchasePhotos purchaseId="p-1" photos={photos} onChange={() => undefined} />,
    );
    const img = await screen.findByRole('img', { name: 'صورة الفاتورة 1' });
    expect(img).toHaveAttribute('src', 'blob:photo-1');
    expect(requestsTo('GET', '/v1/purchases/p-1/attachments/a-1?size=thumb')).toHaveLength(1);
    unmount();
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:photo-1');
  });

  it('opens the full photo by fetching it and showing the object URL in a new tab', async () => {
    stubUrls();
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.fn(() => tab);
    vi.stubGlobal('open', open);
    const { requestsTo } = mockFetch({
      'GET /v1/purchases/p-1/attachments/a-1?size=thumb': { status: 200, body: 'x' },
      'GET /v1/purchases/p-1/attachments/a-1': { status: 200, body: 'y' },
    });
    render(<PurchasePhotos purchaseId="p-1" photos={photos} onChange={() => undefined} />);
    await screen.findByRole('img', { name: 'صورة الفاتورة 1' });
    await userEvent.click(screen.getByRole('button', { name: 'افتح الصورة 1' }));
    await waitFor(() => expect(tab.location.href).toMatch(/^blob:photo-/));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(requestsTo('GET', '/v1/purchases/p-1/attachments/a-1')).toHaveLength(1);
  });

  it('says so and closes the empty tab when the photo cannot be fetched', async () => {
    stubUrls();
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => tab),
    );
    mockFetch({
      'GET /v1/purchases/p-1/attachments/a-1?size=thumb': { status: 200, body: 'x' },
      'GET /v1/purchases/p-1/attachments/a-1': {
        status: 404,
        body: { error: { code: 'not_found', message: 'هذه الصورة غير موجودة.' } },
      },
    });
    render(<PurchasePhotos purchaseId="p-1" photos={photos} onChange={() => undefined} />);
    await screen.findByRole('img', { name: 'صورة الفاتورة 1' });
    await userEvent.click(screen.getByRole('button', { name: 'افتح الصورة 1' }));
    expect(await screen.findByText('هذه الصورة غير موجودة.')).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
  });
});
