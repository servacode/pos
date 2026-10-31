import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Category, Permission } from '@serva/core';
import { catalogMe, categories, category, ids } from '../../test/catalog';
import { apiError, mockFetch, type MockReply, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

type Routes = Record<string, MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>)>;

function openCategories(
  items: Category[] | (() => Category[]) = categories,
  routes: Routes = {},
  permissions?: Permission[],
) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: catalogMe(permissions) },
    'GET /v1/categories': () => ({
      status: 200,
      body: { items: typeof items === 'function' ? items() : items },
    }),
    ...routes,
  });
  return { ...mock, ...renderApp('/categories') };
}

const rowNames = () =>
  within(screen.getByRole('list', { name: 'التصنيفات' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('a')?.textContent);

describe('/categories', () => {
  it('shows the tree with each category’s products, children under their parent', async () => {
    openCategories();

    expect(await screen.findByRole('heading', { name: 'التصنيفات', level: 1 })).toBeInTheDocument();
    expect(rowNames()).toEqual(['ألبان وأجبان', 'أجبان', 'منظفات']);
    const [dairy, cheese, cleaning] = within(screen.getByRole('list', { name: 'التصنيفات' })).getAllByRole(
      'listitem',
    );
    expect(dairy).toHaveTextContent('12 منتج');
    expect(cheese).toHaveStyle({ paddingInlineStart: '2.5rem' });
    expect(cleaning).toHaveTextContent('لا منتجات');
    expect(within(dairy!).getByRole('link', { name: 'ألبان وأجبان' })).toHaveAttribute(
      'href',
      `/products?category=${ids.dairy}`,
    );
    const nav = screen.getByRole('navigation', { name: 'القائمة الرئيسية' });
    expect(within(nav).getByRole('link', { name: 'التصنيفات' })).toHaveAttribute('aria-current', 'page');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('says there is none yet', async () => {
    openCategories([]);
    expect(await screen.findByText('لا تصنيفات بعد.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'أضف تصنيفاً' })).toHaveLength(2);
  });

  it('shows a load error with a retry', async () => {
    let fail = true;
    const { user } = openCategories(categories, {
      'GET /v1/categories': () =>
        fail
          ? apiError(503, 'unavailable', 'الخادم مشغول حالياً.')
          : { status: 200, body: { items: categories } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('الخادم مشغول حالياً.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
    expect(await screen.findByText('منظفات')).toBeInTheDocument();
  });

  it('adds a category under a parent', async () => {
    const created = category({
      id: '00000000-0000-4000-8000-0000000000a9',
      name: 'ألبان مجففة',
      parentId: ids.dairy,
      productCount: 0,
    });
    const { user, requestsTo } = openCategories(categories, {
      'POST /v1/categories': { status: 201, body: created },
    });

    await user.click(await screen.findByRole('button', { name: 'أضف تصنيفاً تحت «ألبان وأجبان»' }));
    const dialog = await screen.findByRole('dialog', { name: 'أضف تصنيفاً' });
    expect(within(dialog).getByLabelText('يتبع')).toHaveValue(ids.dairy);
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(within(dialog).getByText('اسم التصنيف مطلوب')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('اسم التصنيف'), 'ألبان مجففة');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(requestsTo('POST', '/v1/categories')[0]!.body).toEqual({
      name: 'ألبان مجففة',
      parentId: ids.dairy,
      sortOrder: 0,
    });
    expect(rowNames()).toEqual(['ألبان وأجبان', 'أجبان', 'ألبان مجففة', 'منظفات']);
  });

  it('moves a category, never under itself or its children', async () => {
    const { user, requestsTo } = openCategories(categories, {
      [`PATCH /v1/categories/${ids.dairy}`]: (request) => ({
        status: 200,
        body: { ...categories[0], ...(request.body as object), version: 2 },
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'عدّل «ألبان وأجبان»' }));
    const dialog = await screen.findByRole('dialog', { name: 'عدّل «ألبان وأجبان»' });
    const parent = within(dialog).getByLabelText('يتبع');
    expect(
      within(parent)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['لا شيء (تصنيف رئيسي)', 'منظفات']);
    await user.selectOptions(parent, ids.cleaning);
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));

    await vi.waitFor(() => expect(requestsTo('PATCH', `/v1/categories/${ids.dairy}`)).toHaveLength(1));
    expect(requestsTo('PATCH', `/v1/categories/${ids.dairy}`)[0]!.body).toEqual({
      version: 1,
      name: 'ألبان وأجبان',
      parentId: ids.cleaning,
      sortOrder: 0,
    });
    await vi.waitFor(() => expect(rowNames()).toEqual(['منظفات', 'ألبان وأجبان', 'أجبان']));
  });

  it('archives and restores', async () => {
    const { user, requestsTo } = openCategories(categories, {
      [`PATCH /v1/categories/${ids.cleaning}`]: (request) => ({
        status: 200,
        body: {
          ...categories[2],
          archivedAt: (request.body as { archived: boolean }).archived ? '2026-10-31T08:00:00.000Z' : null,
          version: 2,
        },
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'أرشف «منظفات»' }));
    expect(await screen.findByText('مؤرشف')).toBeInTheDocument();
    expect(requestsTo('PATCH', `/v1/categories/${ids.cleaning}`)[0]!.body).toEqual({
      version: 1,
      archived: true,
    });
    await user.click(screen.getByRole('button', { name: 'أعد «منظفات»' }));
    await vi.waitFor(() => expect(screen.queryByText('مؤرشف')).not.toBeInTheDocument());
  });

  it('reloads when someone changed the category first', async () => {
    const { user, requestsTo } = openCategories(categories, {
      [`PATCH /v1/categories/${ids.cleaning}`]: apiError(409, 'stale_version', 'تغيّر السجل.'),
    });
    await user.click(await screen.findByRole('button', { name: 'أرشف «منظفات»' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'غيّر أحدٌ هذا التصنيف للتو. حدّثنا القائمة، جرّب مرة أخرى.',
    );
    await vi.waitFor(() => expect(requestsTo('GET', '/v1/categories')).toHaveLength(2));
  });

  it('shows the server’s field error in the form', async () => {
    const { user } = openCategories(categories, {
      'POST /v1/categories': apiError(400, 'validation_failed', 'تحقّق من البيانات.', {
        name: 'يوجد تصنيف بهذا الاسم',
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'أضف تصنيفاً' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('اسم التصنيف'), 'منظفات');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await within(dialog).findByText('يوجد تصنيف بهذا الاسم')).toBeInTheDocument();
  });

  it('is read-only without catalog.manage', async () => {
    openCategories(categories, {}, ['sale.create']);
    await screen.findByText('منظفات');
    expect(screen.queryByRole('button', { name: /أضف|عدّل|أرشف/ })).not.toBeInTheDocument();
  });
});
