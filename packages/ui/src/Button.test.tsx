import { screen } from '@testing-library/react';
import { Fragment } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button';
import { CONTROL_HEIGHT } from './context';
import { AddIcon, SearchIcon } from './icons';
import { Spinner } from './Spinner';
import { renderUi } from './test/render';
import { TextLink } from './TextLink';

const CONTROL_SIZES = ['xs', 'sm', 'md', 'lg'] as const;

/** A button's height under a finger, in spacing steps: its `pointer-coarse:` class, else its only one. */
function fingerHeight(button: HTMLElement, prefix: 'min-h-' | 'size-'): number {
  const names = [...button.classList];
  const finger =
    names.find((name) => name.startsWith(`pointer-coarse:${prefix}`)) ??
    names.find((name) => name.startsWith(prefix));
  return Number(finger?.split(prefix)[1]);
}

describe('Button', () => {
  it('is a real type="button" in the brand colour by default', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(<Button onClick={onClick}>احفظ المنتج</Button>);

    const button = screen.getByRole('button', { name: 'احفظ المنتج' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-brand', 'text-on-brand', 'hover:bg-brand-hover', 'font-semibold');
    expect(button).toHaveClass('min-h-10', 'pointer-coarse:min-h-12');
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'secondary',
      ['bg-surface', 'text-ink', 'border-line-control/50', 'shadow-e1', 'hover:bg-surface-muted'],
    ],
    ['ghost', ['text-ink-muted', 'hover:bg-surface-muted', 'hover:text-ink']],
    ['danger', ['bg-danger', 'text-on-danger']],
    ['danger-soft', ['bg-danger-soft', 'text-danger-ink']],
  ] as const)('draws the %s variant with its tokens', (variant, tokens) => {
    renderUi(<Button variant={variant}>احذف</Button>);
    expect(screen.getByRole('button')).toHaveClass(...tokens);
  });

  it('is never a pill: the control corner at every size, the card corner on the pay bar', () => {
    renderUi(
      <>
        {CONTROL_SIZES.map((size) => (
          <Button key={size} size={size}>
            {size}
          </Button>
        ))}
        <Button size="pay">ادفع</Button>
      </>,
    );

    for (const size of CONTROL_SIZES) {
      const button = screen.getByRole('button', { name: size });
      expect(button).toHaveClass('rounded-control');
      expect(button).not.toHaveClass('rounded-full');
    }
    expect(screen.getByRole('button', { name: 'ادفع' })).toHaveClass('rounded-card');
  });

  it('puts its icon before the label', () => {
    renderUi(<Button icon={<AddIcon />}>أضف منتجاً</Button>);
    const button = screen.getByRole('button', { name: 'أضف منتجاً' });
    expect(button.firstChild).toBe(button.querySelector('svg'));
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

  it('puts the spinner in its icon’s place while loading, and keeps the label in view', () => {
    renderUi(
      <Button loading icon={<AddIcon />}>
        احفظ
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'احفظ' });
    expect(button).toHaveClass('cursor-wait');
    for (const name of ['opacity-50', 'motion-safe:active:scale-[0.98]']) {
      expect(button).not.toHaveClass(name);
    }
    // The spinner, then the label, and nothing else: the icon is gone and nothing covers the label.
    const [spinner, label, ...others] = [...button.childNodes];
    expect(spinner).toBe(button.querySelector('svg'));
    expect(spinner).toHaveClass('motion-safe:animate-spin');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(label?.nodeType).toBe(Node.TEXT_NODE);
    expect(label?.textContent).toBe('احفظ');
    expect(others).toEqual([]);
  });

  it('puts the spinner before the label of a button with no icon, in the variant’s own colours', () => {
    renderUi(
      <Button variant="ghost" loading>
        إلغاء
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'إلغاء' });
    expect(button).toHaveTextContent('إلغاء');
    expect(button.childNodes).toHaveLength(2);
    expect(button.firstChild).toBe(button.querySelector('svg'));
    expect(button.firstChild).toHaveClass('motion-safe:animate-spin');
    expect(button.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(button.lastChild?.textContent).toBe('إلغاء');
    // Nothing covers the label, so a busy ghost needs no fill of its own.
    expect(button).toHaveClass('text-ink-muted');
    expect(button).not.toHaveClass('bg-surface-muted');
  });

  it('dims to half when disabled, and then neither answers hover nor shrinks when pressed', () => {
    renderUi(
      <>
        <Button disabled>احذف</Button>
        <Button>احفظ</Button>
      </>,
    );

    const off = screen.getByRole('button', { name: 'احذف' });
    expect(off).toHaveClass('opacity-50', 'cursor-not-allowed');
    for (const name of ['hover:bg-brand-hover', 'motion-safe:active:scale-[0.98]']) {
      expect(off).not.toHaveClass(name);
    }
    expect(screen.getByRole('button', { name: 'احفظ' })).toHaveClass('motion-safe:active:scale-[0.98]');
  });

  it('shows a pressed toggle in the brand tint', () => {
    renderUi(
      <Button variant="secondary" aria-pressed>
        جملة
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'جملة', pressed: true })).toHaveClass(
      'aria-pressed:bg-brand-soft',
      'aria-pressed:text-brand-ink',
    );
  });

  it.each([
    ['touch', ['min-h-14']],
    ['comfortable', ['min-h-10', 'pointer-coarse:min-h-12']],
    ['compact', ['min-h-9', 'pointer-coarse:min-h-11']],
    ['dense', ['min-h-8']],
  ] as const)('takes its height from the %s density', (density, heights) => {
    renderUi(<Button>احفظ</Button>, { density });
    const button = screen.getByRole('button');
    expect(button).toHaveClass(...heights);
    expect(button).toHaveClass(...CONTROL_HEIGHT[density].split(' '));
  });

  it('never goes under 48 px on the touch density, even when asked for a small size', () => {
    renderUi(
      <>
        <Button size="sm">صغير</Button>
        <Button size="xs">أصغر</Button>
        <Button size="md">وسط</Button>
        <IconButton size="sm" label="ابحث" icon={<SearchIcon />} />
      </>,
      { density: 'touch' },
    );

    expect(screen.getByRole('button', { name: 'صغير' })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: 'أصغر' })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: 'وسط' })).toHaveClass('min-h-12');
    expect(screen.getByRole('button', { name: 'ابحث' })).toHaveClass('size-12');
  });

  it('keeps the 72 px pay bar whatever the density: bold, label at the start, amount at the end', () => {
    renderUi(
      <Button size="pay">
        <span>ادفع</span>
        <span>13,420</span>
      </Button>,
      { density: 'dense' },
    );

    const pay = screen.getByRole('button');
    expect(pay).toHaveClass('min-h-18', 'w-full', 'justify-between', 'font-bold');
    // No competing class: `cn` does not merge, so these would silently win over the pay bar's own.
    for (const name of ['justify-center', 'font-semibold', 'rounded-control']) {
      expect(pay).not.toHaveClass(name);
    }
    expect([...pay.classList].filter((name) => name.includes('min-h-'))).toEqual(['min-h-18']);
  });

  it.each(['touch', 'comfortable', 'compact', 'dense'] as const)(
    'has one height with a mouse and at most one under a finger at every size on the %s density',
    (density) => {
      renderUi(
        <>
          {CONTROL_SIZES.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </>,
        { density },
      );

      // `cn` does not merge: two heights for the same pointer would fight in the style sheet.
      for (const size of CONTROL_SIZES) {
        const names = [...screen.getByRole('button', { name: size }).classList];
        expect(names.filter((name) => /^min-h-\d+$/.test(name))).toHaveLength(1);
        expect(names.filter((name) => /^pointer-coarse:min-h-\d+$/.test(name)).length).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each(['comfortable', 'compact'] as const)(
    'is never under the %s density’s touch target under a finger, whatever the size',
    (density) => {
      // The touch target is the density's own control height under a finger (context.tsx).
      const target = Number(/pointer-coarse:min-h-(\d+)/.exec(CONTROL_HEIGHT[density])![1]);
      renderUi(
        <>
          {CONTROL_SIZES.map((size) => (
            <Fragment key={size}>
              <Button size={size}>{size}</Button>
              <IconButton size={size} label={`أيقونة ${size}`} icon={<SearchIcon />} />
            </Fragment>
          ))}
        </>,
        { density },
      );

      for (const size of CONTROL_SIZES) {
        const button = screen.getByRole('button', { name: size });
        const square = screen.getByRole('button', { name: `أيقونة ${size}` });
        expect(fingerHeight(button, 'min-h-')).toBeGreaterThanOrEqual(target);
        expect(fingerHeight(square, 'size-')).toBeGreaterThanOrEqual(target);
      }
    },
  );

  it.each([
    ['xs', 'comfortable', ['min-h-8', 'pointer-coarse:min-h-12']],
    ['sm', 'comfortable', ['min-h-9', 'pointer-coarse:min-h-12']],
    ['xs', 'compact', ['min-h-8', 'pointer-coarse:min-h-11']],
    ['sm', 'compact', ['min-h-9', 'pointer-coarse:min-h-11']],
    // The dense screens are for a mouse.
    ['xs', 'dense', ['min-h-8']],
  ] as const)(
    'keeps an %s button small with a mouse on the %s density, and raises it under a finger',
    (size, density, heights) => {
      renderUi(<Button size={size}>احفظ</Button>, { density });
      const names = [...screen.getByRole('button').classList];
      expect(names.filter((name) => name.includes('min-h-'))).toEqual(heights);
    },
  );

  it('stays 48 under a finger when a screen gives a small admin button its own height', () => {
    // Tailwind writes the pointer-coarse rules last, so on a phone the size's finger height wins
    // over the className's min-h-12: it must not be lower (DeviceRow's «أوقف عن بُعد»).
    renderUi(
      <Button size="sm" variant="danger-soft" className="min-h-12 sm:min-h-10">
        أوقف عن بُعد
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'أوقف عن بُعد' });
    expect(button).toHaveClass('pointer-coarse:min-h-12');
    expect(button).not.toHaveClass('pointer-coarse:min-h-11');
  });
});

describe('IconButton', () => {
  it('is named by its label for screen readers and shows it on hover', () => {
    renderUi(<IconButton label="ابحث" icon={<SearchIcon />} />);

    const button = screen.getByRole('button', { name: 'ابحث' });
    expect(button).toHaveAttribute('title', 'ابحث');
    expect(button).toHaveClass('size-10', 'pointer-coarse:size-12', 'rounded-control', 'text-ink-muted');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['touch', 'comfortable', 'compact', 'dense'] as const)(
    'is as tall as a Button of the same size on the %s density',
    (density) => {
      renderUi(
        <>
          {CONTROL_SIZES.map((size) => (
            <Fragment key={size}>
              <Button size={size}>{size}</Button>
              <IconButton size={size} label={`أيقونة ${size}`} icon={<SearchIcon />} />
            </Fragment>
          ))}
        </>,
        { density },
      );

      for (const size of CONTROL_SIZES) {
        const heights = screen
          .getByRole('button', { name: size })
          .className.split(' ')
          .filter((name) => /^(pointer-coarse:)?min-h-\d+$/.test(name));
        expect(heights.length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: `أيقونة ${size}` })).toHaveClass(
          ...heights.map((name) => name.replace('min-h-', 'size-')),
        );
      }
    },
  );

  it('turns its icon into the spinner while busy', () => {
    renderUi(<IconButton label="أرشف" icon={<SearchIcon />} loading />);

    const button = screen.getByRole('button', { name: 'أرشف' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button.querySelector('svg')).toHaveClass('motion-safe:animate-spin');
  });
});

describe('TextLink', () => {
  it('is brand-ink and semibold, underlined on hover and on keyboard focus', () => {
    renderUi(<TextLink href="/terms">الشروط</TextLink>);
    expect(screen.getByRole('link', { name: 'الشروط' })).toHaveClass(
      'text-brand-ink',
      'font-semibold',
      'underline-offset-4',
      'hover:decoration-current',
      'focus-visible:decoration-current',
    );
  });
});

describe('Spinner', () => {
  it('is decoration without a label, and a status with one', () => {
    renderUi(
      <>
        <Spinner />
        <Spinner label="جارٍ التحميل…" />
      </>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل…');
    for (const svg of document.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws in the text colour at an icon size, and turns only where motion is allowed', () => {
    const { container } = renderUi(<Spinner size={16} />);

    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveClass('motion-safe:animate-spin');
    expect(svg).not.toHaveClass('animate-spin');
    for (const shape of svg.children) expect(shape).toHaveAttribute('stroke', 'currentColor');
  });
});
