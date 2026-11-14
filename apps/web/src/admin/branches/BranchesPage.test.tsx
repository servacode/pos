import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BranchAdminRow, MeResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

const row = (over: Partial<BranchAdminRow>): BranchAdminRow => ({
  id: 'b-1',
  code: '001',
  name: 'الفرع الرئيسي',
  address: null,
  phone: null,
  isActive: true,
  deviceCount: 2,
  staffCount: 0,
  ...over,
});

function open() {
  let rows = [row({})];
  const base = makeMe();
  const me: MeResponse = {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage'] },
  };
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: me },
    'GET /v1/branches': () => ({ status: 200, body: rows }),
    'POST /v1/branches': (r: MockRequest) => {
      const body = r.body as { name: string };
      if (body.name.length < 2)
        return apiError(400, 'validation_failed', 'تحقّق من الحقول', { name: 'اكتب اسم الفرع' });
      rows = [...rows, row({ id: 'b-2', code: '002', name: body.name, deviceCount: 0 })];
      return { status: 201, body: rows[1] };
    },
    'POST /v1/branches/b-1/active': () => apiError(409, 'conflict', 'لا يمكن إيقاف آخر فرع فعّال.'),
  });
  return { ...mock, ...renderApp('/branches') };
}

describe('«الفروع»', () => {
  it('lists the branches with their devices in correct Arabic', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'الفروع', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'الفروع' });
    expect(await within(table).findByText('الفرع الرئيسي')).toBeInTheDocument();
    expect(within(table).getByText('جهازان')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('adds a branch, showing the message of a short name on the field', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'فرع جديد' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('اسم الفرع'), 'م');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await within(dialog).findByText('اكتب اسم الفرع')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('اسم الفرع'));
    await user.type(within(dialog).getByLabelText('اسم الفرع'), 'فرع المزة');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('فرع المزة')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/branches').at(-1)?.body).toMatchObject({ name: 'فرع المزة' });
  });

  it('shows why the last branch cannot be stopped', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'أوقف' }));
    expect(await screen.findByText('لا يمكن إيقاف آخر فرع فعّال.')).toBeInTheDocument();
  });
});
