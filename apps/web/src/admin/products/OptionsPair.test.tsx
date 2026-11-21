import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OptionsEditor } from './OptionsEditor';
import { DEFAULT_AXIS_NAMES, type Axis } from './form';
import { mockFetch } from '../../test/fetchMock';

describe('«بمقاسين»: الخصر × الطول', () => {
  it('names the first two options waist and length in one tap', async () => {
    mockFetch({ 'GET /v1/products/options': { status: 200, body: { options: [] } } });
    const axes: Axis[] = DEFAULT_AXIS_NAMES.map((name, i) => ({ key: `a${i}`, name, values: [] }));
    const onChange = vi.fn();
    render(<OptionsEditor axes={axes} variantCount={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'بنطلون: الخصر × الطول' }));
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as Axis[];
    expect(next.map((a) => a.name)).toEqual(['الخصر', 'الطول']);
  });
});
