import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button';
import { SearchIcon } from './icons';
import { renderUi } from './test/render';

describe('Button', () => {
  it('is a real type="button" in the brand colour by default', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(<Button onClick={onClick}>احفظ المنتج</Button>);

    const button = screen.getByRole('button', { name: 'احفظ المنتج' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-brand', 'text-on-brand', 'min-h-12');
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    ['secondary', 'border-line-control'],
    ['ghost', 'hover:bg-surface-muted'],
    ['danger', 'bg-danger'],
    ['danger-soft', 'bg-danger-soft'],
  ] as const)('draws the %s variant with its tokens', (variant, token) => {
    renderUi(<Button variant={variant}>احذف</Button>);
    expect(screen.getByRole('button')).toHaveClass(token);
  });

  it('is busy and cannot be pressed again while loading', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(
      <Button loading onClick={onClick}>
        احفظ
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'احفظ' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ['touch', 'min-h-14'],
    ['comfortable', 'min-h-12'],
    ['compact', 'min-h-10'],
    ['dense', 'min-h-8'],
  ] as const)('takes its height from the %s density', (density, height) => {
    renderUi(<Button>احفظ</Button>, { density });
    expect(screen.getByRole('button')).toHaveClass(height);
  });

  it('never goes under 48 px on the touch density, even when asked for a small size', () => {
    renderUi(
      <>
        <Button size="sm">صغير</Button>
        <Button size="xs">أصغر</Button>
        <IconButton size="sm" label="ابحث" icon={<SearchIcon />} />
      </>,
      { density: 'touch' },
    );

    expect(screen.getByRole('button', { name: 'صغير' })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: 'أصغر' })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: 'ابحث' })).toHaveClass('size-12');
  });

  it('keeps the 72 px pay button whatever the density', () => {
    renderUi(<Button size="pay">ادفع</Button>, { density: 'dense' });
    expect(screen.getByRole('button')).toHaveClass('min-h-18', 'w-full');
  });
});

describe('IconButton', () => {
  it('is named by its label for screen readers and shows it on hover', () => {
    renderUi(<IconButton label="ابحث" icon={<SearchIcon />} />);

    const button = screen.getByRole('button', { name: 'ابحث' });
    expect(button).toHaveAttribute('title', 'ابحث');
    expect(button).toHaveClass('size-12');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
