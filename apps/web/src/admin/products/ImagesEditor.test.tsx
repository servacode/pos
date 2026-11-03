import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductImage } from '@serva/core';
import { catalogMe, ids, lookupRoutes, product } from '../../test/catalog';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { fitWithin } from '../../lib/images';
import type * as Images from '../../lib/images';
import { ImagesEditor } from './ImagesEditor';

vi.mock('../../lib/images', async (actual) => ({
  ...(await actual<typeof Images>()),
  resizeImage: vi.fn(async (file: File) => {
    if (file.name.startsWith('broken')) throw new Error('not an image');
    return { contentType: 'image/jpeg', data: btoa(file.name), thumb: btoa('t'), width: 1600, height: 1200 };
  }),
}));

const base = `/v1/products/${ids.milk}/images`;
const image = (n: number, extra: Partial<ProductImage> = {}): ProductImage => ({
  id: `img-${n}`,
  uploadId: `up-${n}`,
  url: `/v1/images/t/up-${n}`,
  thumbUrl: `/v1/images/t/up-${n}?size=thumb`,
  optionValue: null,
  sortOrder: n,
  width: 1600,
  height: 1200,
  version: 1,
  ...extra,
});

describe('«الصور» on the product card', () => {
  it('adds pictures resized, skips one it cannot read, makes one the main one, and deletes one', async () => {
    let items: ProductImage[] = [image(0)];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      ...lookupRoutes,
      [`GET /v1/products/${ids.milk}`]: {
        status: 200,
        body: product(),
      },
      [`GET ${base}`]: () => ({ status: 200, body: { items } }),
      [`POST ${base}`]: (r: MockRequest) => {
        const made = image(items.length);
        items = [...items, made];
        expect(r.body).toMatchObject({
          contentType: 'image/jpeg',
          width: 1600,
          height: 1200,
          optionValue: null,
        });
        return { status: 201, body: made };
      },
      [`POST ${base}/order`]: (r: MockRequest) => {
        const order = (r.body as { ids: string[] }).ids;
        items = order.map((id) => items.find((i) => i.id === id)!);
        return { status: 200, body: { items } };
      },
      [`DELETE ${base}/img-0`]: () => {
        items = items.filter((i) => i.id !== 'img-0');
        return { status: 204 };
      },
    });
    const { user } = renderApp(`/products/${ids.milk}`);
    const gallery = await screen.findByRole('list', { name: 'صور المنتج' });
    expect(await within(gallery).findByRole('img', { name: 'الصورة الرئيسية' })).toHaveAttribute(
      'src',
      '/v1/images/t/up-0?size=thumb',
    );

    const files = [
      new File(['a'], 'front.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'broken.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'back.jpg', { type: 'image/jpeg' }),
    ];
    await user.upload(screen.getByLabelText('اختر صوراً'), files);
    expect(await within(gallery).findByRole('img', { name: 'صورة 3' })).toBeInTheDocument();
    expect(requestsTo('POST', base)).toHaveLength(2);
    expect(screen.getByText(/«broken.jpg» ليس صورة/)).toBeInTheDocument();

    const third = within(gallery).getAllByRole('listitem')[2]!;
    await user.click(within(third).getByRole('button', { name: 'اجعلها الرئيسية' }));
    expect(requestsTo('POST', `${base}/order`)[0]!.body).toEqual({ ids: ['img-2', 'img-0', 'img-1'] });

    await vi.waitFor(() => expect(within(gallery).getAllByRole('listitem')).toHaveLength(3));
    await user.click(within(gallery).getByRole('button', { name: 'احذف الصورة 2' }));
    await vi.waitFor(() => expect(within(gallery).getAllByRole('listitem')).toHaveLength(2));
  });

  it('gives a picture to one colour of the pieces, or back to all of them', async () => {
    let items = [image(0), image(1)];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      [`GET ${base}`]: () => ({ status: 200, body: { items } }),
      [`PATCH ${base}/img-1`]: (r: MockRequest) => {
        const optionValue = (r.body as { optionValue: string | null }).optionValue;
        items = [items[0]!, { ...items[1]!, optionValue, version: 2 }];
        return { status: 200, body: items[1] };
      },
    });
    const user = userEvent.setup();
    render(<ImagesEditor productId={ids.milk} optionValues={['أحمر', 'أزرق']} />);
    const pick = await screen.findByRole('combobox', { name: 'لمن الصورة 2' });
    await user.selectOptions(pick, 'أحمر');
    expect(requestsTo('PATCH', `${base}/img-1`)[0]!.body).toEqual({ version: 1, optionValue: 'أحمر' });
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'لمن الصورة 2' })).toHaveValue('أحمر'),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'لمن الصورة 2' }), 'لكل القطع');
    expect(requestsTo('PATCH', `${base}/img-1`)[1]!.body).toEqual({ version: 2, optionValue: null });
  });

  it('asks to save a new product before its pictures', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: catalogMe() },
      ...lookupRoutes,
    });
    renderApp('/products/new');
    expect(await screen.findByText('احفظ المنتج أولاً، ثم أضف صوره هنا.')).toBeInTheDocument();
  });

  it('fits a picture within its long side, never enlarging it', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(900, 1800, 400)).toEqual({ width: 200, height: 400 });
    expect(fitWithin(300, 200, 1600)).toEqual({ width: 300, height: 200 });
  });
});
