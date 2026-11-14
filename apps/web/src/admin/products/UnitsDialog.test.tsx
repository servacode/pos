import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Unit } from '@serva/core';
import { catalogMe, lookupRoutes, units } from '../../test/catalog';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function open(permissions?: Parameters<typeof catalogMe>[0], extra = {}) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe(permissions) },
    ...lookupRoutes,
    ...extra,
  });
  return { ...mock, ...renderApp('/products/new') };
}

const box: Unit = {
  id: 'unit-box',
  name: 'علبة',
  symbol: 'علبة',
  allowsFraction: false,
  isSystem: false,
  archivedAt: null,
  version: 1,
};

describe('«الوحدات» on the product card', () => {
  it('adds a box unit from the card and offers it to the product at once', async () => {
    const { user, requestsTo } = open(undefined, {
      'POST /v1/units': (r: MockRequest) => ({
        status: 201,
        body: { ...box, name: (r.body as { name: string }).name },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'أضف وحدة (علبة، كرتونة، متر…)' }));
    const dialog = await screen.findByRole('dialog', { name: 'الوحدات' });
    // The two the store came with, and a suggestion to start from
    expect(within(dialog).getAllByText('قطعة').length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole('button', { name: 'علبة' }));
    expect(within(dialog).getByLabelText('اسم الوحدة')).toHaveValue('علبة');
    await user.click(within(dialog).getByRole('button', { name: 'أضف الوحدة' }));
    expect(await within(dialog).findByRole('list', { name: 'الوحدات الحالية' })).toHaveTextContent('علبة');
    expect(requestsTo('POST', '/v1/units')[0]?.body).toEqual({
      name: 'علبة',
      symbol: 'علبة',
      allowsFraction: false,
    });
    await user.click(within(dialog).getByRole('button', { name: 'تمّ' }));
    expect(screen.getByRole('option', { name: 'علبة' })).toBeInTheDocument();
  });

  it('archives a unit of its own, never one the store came with, and names a refused one', async () => {
    const { user, requestsTo } = open(undefined, {
      'GET /v1/units': { status: 200, body: { items: [...units, box] } },
      'PATCH /v1/units/unit-box': (r: MockRequest) => ({
        status: 200,
        body: { ...box, version: 2, archivedAt: (r.body as { archived: boolean }).archived ? 'now' : null },
      }),
      'POST /v1/units': apiError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        name: 'هذه الوحدة موجودة',
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'أضف وحدة (علبة، كرتونة، متر…)' }));
    const dialog = await screen.findByRole('dialog', { name: 'الوحدات' });
    expect(within(dialog).queryByRole('button', { name: /قطعة/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'أرشف الوحدة علبة' }));
    expect(await within(dialog).findByText('مؤرشفة')).toBeInTheDocument();
    expect(requestsTo('PATCH', '/v1/units/unit-box')[0]?.body).toEqual({ version: 1, archived: true });
    await user.click(within(dialog).getByRole('button', { name: 'أعد الوحدة علبة' }));
    await user.type(within(dialog).getByLabelText('اسم الوحدة'), 'قطعة');
    await user.click(within(dialog).getByRole('button', { name: 'أضف الوحدة' }));
    expect(await within(dialog).findByText('هذه الوحدة موجودة')).toBeInTheDocument();
  });

  it('does not offer it to someone who cannot manage the catalog', async () => {
    open(['devices.view']);
    await screen.findByRole('heading', { name: 'منتج جديد', level: 1 });
    expect(screen.queryByRole('button', { name: 'أضف وحدة (علبة، كرتونة، متر…)' })).not.toBeInTheDocument();
  });
});
