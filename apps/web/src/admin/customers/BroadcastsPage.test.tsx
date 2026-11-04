import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Broadcast, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'customers.view', 'customers.manage'] },
  };
}

const SENT: Broadcast = {
  id: 'b-1',
  text: 'نور للأزياء\nوصلت التشكيلة الشتوية!\n\nلا تريد رسائلنا؟ أخبرنا ونوقفها.',
  audience: { kind: 'all' },
  status: 'done',
  total: 42,
  sent: 41,
  failed: 1,
  createdAt: '2026-11-04T10:00:00.000Z',
  finishedAt: '2026-11-04T10:02:00.000Z',
};

describe('«رسائل للزبائن»', () => {
  it('says how many it reaches, sends it, and lists what went', async () => {
    let sent = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/categories': { status: 200, body: { items: [] } },
      'GET /v1/broadcasts': () => ({ status: 200, body: { items: sent ? [SENT] : [] } }),
      'POST /v1/broadcasts/preview': { status: 200, body: { count: 42 } },
      'POST /v1/broadcasts': (r: MockRequest) => {
        expect(r.body).toEqual({ text: 'وصلت التشكيلة الشتوية!', audience: { kind: 'all' } });
        sent = true;
        return { status: 201, body: { ...SENT, status: 'sending', sent: 0, failed: 0 } };
      },
    });
    const { user } = renderApp('/messages');
    expect(await screen.findByText('تصل إلى 42 زبون.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('الرسالة'), 'وصلت التشكيلة الشتوية!');
    await user.click(screen.getByRole('button', { name: 'أرسل' }));
    expect(await screen.findByText('41 / 42 · لم تصل 1')).toBeInTheDocument();
    await vi.waitFor(() => expect(requestsTo('POST', '/v1/broadcasts')).toHaveLength(1));
  });
});
