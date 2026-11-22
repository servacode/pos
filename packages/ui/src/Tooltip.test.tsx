import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './Button';
import { Dialog } from './Dialog';
import { PanelCollapseIcon, PrintIcon, SunIcon } from './icons';
import { Menu, MenuItem } from './Menu';
import { renderUi } from './test/render';
import { placeFloating, Tooltip } from './Tooltip';

function PrintButton({ onClick }: { onClick?: () => void }) {
  return (
    <Tooltip content="اطبع آخر فاتورة">
      <IconButton label="اطبع" icon={<PrintIcon />} onClick={onClick} />
    </Tooltip>
  );
}

describe('Tooltip', () => {
  // First: no other hint has closed yet, so the hover delay is the full one.
  it('shows after the pointer rests on the control, and goes when it leaves', async () => {
    const { user } = renderUi(<PrintButton />);
    const button = screen.getByRole('button', { name: 'اطبع' });

    await user.hover(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('اطبع آخر فاتورة');

    await user.unhover(button);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('shows at once when the keyboard reaches the control, and describes it', async () => {
    const { user } = renderUi(<PrintButton />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();

    const button = screen.getByRole('button', { name: 'اطبع' });
    expect(button).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('اطبع آخر فاتورة');
    expect(button).toHaveAccessibleDescription('اطبع آخر فاتورة');
    expect(screen.getByRole('tooltip').parentElement).toHaveAttribute('dir', 'rtl');
    // Tab 14 › الطبقات: the toasts' layer, under the cashier's status bar (60).
    expect(screen.getByRole('tooltip').parentElement).toHaveClass('z-50');
  });

  it('stays away while the menu of its control is open, so it never covers the first choice', async () => {
    const onLight = vi.fn();
    const { user } = renderUi(
      <Menu
        label="المظهر"
        trigger={
          <Tooltip content="المظهر: داكن" side="bottom" delay={0}>
            <IconButton label="تبديل المظهر" icon={<SunIcon />} />
          </Tooltip>
        }
      >
        <MenuItem onSelect={onLight}>فاتح</MenuItem>
      </Menu>,
    );
    const button = screen.getByRole('button', { name: 'تبديل المظهر' });
    await user.click(button);
    expect(screen.getByRole('menu', { name: 'المظهر' })).toBeInTheDocument();

    // The pointer comes back to the button and rests there while the menu is open.
    await user.unhover(button);
    await user.hover(button);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAccessibleDescription();

    await user.click(screen.getByRole('menuitem', { name: 'فاتح' }));
    expect(onLight).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('still hints a control that only expands in place (no popup)', async () => {
    const { user } = renderUi(
      <Tooltip content="اطوِ القائمة">
        <IconButton label="القائمة الجانبية" icon={<PanelCollapseIcon />} aria-expanded="true" />
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('اطوِ القائمة');
  });

  it('hides on Esc, which closes only the hint and not the dialog around it', async () => {
    function InDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen} title="الطابعة">
          <PrintButton />
        </Dialog>
      );
    }
    const { user } = renderUi(<InDialog />);
    await screen.findByRole('dialog', { name: 'الطابعة' });
    screen.getByRole('button', { name: 'اطبع' }).focus();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'الطابعة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).not.toHaveAccessibleDescription();

    // With no hint open, Esc reaches the dialog again.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('hides on blur and on a press, and the control still works', async () => {
    const onClick = vi.fn();
    const { user } = renderUi(
      <>
        <PrintButton onClick={onClick} />
        <button type="button">التالي</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'اطبع' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('replaces the browser title bubble and keeps the control own description', async () => {
    const { user } = renderUi(
      <>
        <Tooltip content="بالعملة الأساسية">
          <button type="button" aria-describedby="hint">
            الرصيد
          </button>
        </Tooltip>
        <p id="hint">آخر تحديث اليوم</p>
      </>,
    );
    const button = screen.getByRole('button', { name: 'الرصيد' });
    expect(button).toHaveAttribute('title', '');
    await user.tab();
    expect(button).toHaveAccessibleDescription('آخر تحديث اليوم بالعملة الأساسية');
  });
});

describe('placeFloating', () => {
  const anchor = { top: 100, bottom: 140, left: 300, right: 340, width: 40, height: 40 } as DOMRect;
  const size = { width: 120, height: 30 };

  it('sits above the control, centred, and flips under it when there is no room', () => {
    expect(placeFloating(anchor, size, 'top', 'center', 'rtl', 6)).toEqual({ x: 260, y: 64 });
    const nearTop = { ...anchor, top: 10, bottom: 50 } as DOMRect;
    expect(placeFloating(nearTop, size, 'top', 'center', 'rtl', 6).y).toBe(56);
  });

  it('lines up with the start edge in the reading direction: the right in Arabic', () => {
    expect(placeFloating(anchor, size, 'bottom', 'start', 'rtl', 6)).toEqual({ x: 220, y: 146 });
    expect(placeFloating(anchor, size, 'bottom', 'start', 'ltr', 6)).toEqual({ x: 300, y: 146 });
    expect(placeFloating(anchor, size, 'bottom', 'end', 'rtl', 6)).toEqual({ x: 300, y: 146 });
  });

  it('puts the start side on the right in Arabic and keeps the box inside the window', () => {
    expect(placeFloating(anchor, size, 'start', 'center', 'rtl', 6)).toEqual({ x: 346, y: 105 });
    expect(placeFloating(anchor, size, 'start', 'center', 'ltr', 6)).toEqual({ x: 174, y: 105 });
    const nearEdge = { ...anchor, left: 0, right: 40 } as DOMRect;
    expect(placeFloating(nearEdge, size, 'bottom', 'end', 'ltr', 6).x).toBe(8);
  });
});
