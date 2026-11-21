import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { KeyIcon, LogoutIcon, SettingsIcon } from './icons';
import { Menu, MenuGroup, MenuItem, MenuLabel, MenuSeparator, type MenuProps } from './Menu';
import { renderUi } from './test/render';

function AccountMenu({
  onLogout,
  onSettings,
  ...state
}: Pick<MenuProps, 'open' | 'onOpenChange'> & { onLogout?: () => void; onSettings?: () => void }) {
  return (
    <Menu label="حسابي" align="end" trigger={<Button variant="ghost">سارة</Button>} {...state}>
      <MenuLabel>بوتيك الأناقة</MenuLabel>
      <MenuItem icon={<SettingsIcon />} onSelect={onSettings}>
        الإعدادات
      </MenuItem>
      <MenuItem icon={<KeyIcon />} href="#pin">
        رمز الدخول للكاشير
      </MenuItem>
      <MenuItem disabled>الاشتراك</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<LogoutIcon />} tone="danger" onSelect={onLogout}>
        تسجيل الخروج
      </MenuItem>
    </Menu>
  );
}

const trigger = () => screen.getByRole('button', { name: 'سارة' });
const item = (name: string) => screen.getByRole('menuitem', { name });

describe('Menu', () => {
  it('is a menu button: closed, then open on a click with focus on the first item', async () => {
    const { user } = renderUi(<AccountMenu />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger());

    const menu = screen.getByRole('menu', { name: 'حسابي' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', menu.id);
    expect(item('الإعدادات')).toHaveFocus();
    expect(menu.parentElement).toHaveAttribute('dir', 'rtl');
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    expect(within(menu).getByText('بوتيك الأناقة')).not.toHaveAttribute('tabindex');
  });

  it('moves with ↑ ↓ Home End, wrapping, and skips a disabled item', async () => {
    const { user } = renderUi(<AccountMenu />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(item('الإعدادات')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(item('رمز الدخول للكاشير')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('تسجيل الخروج')).toHaveFocus();
    expect(item('الاشتراك')).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{ArrowDown}');
    expect(item('الإعدادات')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('تسجيل الخروج')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('الإعدادات')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('تسجيل الخروج')).toHaveFocus();
  });

  it('opens from the keyboard: Enter and Space on the first item, ↑ on the last', async () => {
    const { user } = renderUi(<AccountMenu />);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(item('الإعدادات')).toHaveFocus();
    await user.keyboard('{Escape}');

    await user.keyboard(' ');
    expect(item('الإعدادات')).toHaveFocus();
    await user.keyboard('{Escape}');

    await user.keyboard('{ArrowUp}');
    expect(item('تسجيل الخروج')).toHaveFocus();
  });

  it('closes with Esc and gives focus back to the trigger', async () => {
    const { user } = renderUi(<AccountMenu />);
    await user.click(trigger());
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  it('closes on a click outside and gives focus back to the trigger', async () => {
    const { user } = renderUi(<AccountMenu />);
    await user.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('leaves focus on a field that was clicked outside it', async () => {
    const { user } = renderUi(
      <>
        <AccountMenu />
        <input aria-label="بحث" />
      </>,
    );
    await user.click(trigger());
    await user.click(screen.getByRole('textbox', { name: 'بحث' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByRole('textbox', { name: 'بحث' })).toHaveFocus();
  });

  it('runs the chosen action once, closes, and gives focus back to the trigger', async () => {
    const onLogout = vi.fn();
    const { user } = renderUi(<AccountMenu onLogout={onLogout} />);
    await user.click(trigger());
    await user.click(item('تسجيل الخروج'));

    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    const onSettings = vi.fn();
    const second = renderUi(<AccountMenu onSettings={onSettings} />);
    const button = within(second.container).getByRole('button', { name: 'سارة' });
    button.focus();
    await second.user.keyboard('{Enter}');
    await second.user.keyboard('{Enter}');
    expect(onSettings).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
  });

  it('does nothing for a disabled item', async () => {
    const { user } = renderUi(<AccountMenu />);
    await user.click(trigger());
    item('الاشتراك').click();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Tab', async () => {
    const { user } = renderUi(<AccountMenu />);
    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('draws links as <a href> and other elements through render', async () => {
    const { user } = renderUi(
      <Menu label="المزيد" trigger={<Button>المزيد</Button>}>
        <MenuItem href="#pin">رمز الدخول</MenuItem>
        <MenuItem
          render={({ children, ...props }) => (
            <a href="#plan" data-router-link="" {...props}>
              {children}
            </a>
          )}
        >
          الاشتراك
        </MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'المزيد' }));

    expect(item('رمز الدخول')).toHaveAttribute('href', '#pin');
    expect(item('الاشتراك')).toHaveAttribute('data-router-link');
    expect(item('الاشتراك')).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    expect(item('الاشتراك')).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#plan');
  });

  it('marks the danger item and the chosen one of a set', async () => {
    const { user } = renderUi(
      <Menu label="المظهر" trigger={<Button>المظهر</Button>}>
        <MenuItem checked>فاتح</MenuItem>
        <MenuItem checked={false}>داكن</MenuItem>
        <MenuItem tone="danger">احذف</MenuItem>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'المظهر' }));

    expect(screen.getByRole('menuitemradio', { name: 'فاتح' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'داكن' })).toHaveAttribute('aria-checked', 'false');
    expect(item('احذف')).toHaveClass('text-danger-ink');
  });

  it('names a group by its heading, so screen readers hear who is signed in', async () => {
    const { user } = renderUi(
      <Menu label="حسابي" trigger={<Button variant="ghost">سارة</Button>}>
        <MenuGroup label="مديرة · بوتيك الأناقة">
          <MenuItem icon={<SettingsIcon />}>الإعدادات</MenuItem>
          <MenuItem icon={<KeyIcon />}>رمز الدخول للكاشير</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon={<LogoutIcon />} tone="danger">
          تسجيل الخروج
        </MenuItem>
      </Menu>,
    );
    await user.click(trigger());

    const group = screen.getByRole('group', { name: 'مديرة · بوتيك الأناقة' });
    const grouped = within(group).getAllByRole('menuitem');
    expect(grouped.map((element) => element.textContent)).toEqual(['الإعدادات', 'رمز الدخول للكاشير']);
    expect(within(group).getByText('مديرة · بوتيك الأناقة')).not.toHaveAttribute('tabindex');
    expect(item('الإعدادات')).toHaveFocus();

    // The arrow keys go through the group and out of it as through one list.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('تسجيل الخروج')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('الإعدادات')).toHaveFocus();
  });

  it('works inside a dialog: Esc closes the menu and leaves the dialog open', async () => {
    function InDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen} title="الفاتورة">
          <AccountMenu />
        </Dialog>
      );
    }
    const { user } = renderUi(<InDialog />);
    const dialog = await screen.findByRole('dialog', { name: 'الفاتورة' });
    await user.click(within(dialog).getByRole('button', { name: 'سارة' }));

    const menu = within(dialog).getByRole('menu', { name: 'حسابي' });
    expect(within(menu).getByRole('menuitem', { name: 'الإعدادات' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'الفاتورة' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'سارة' })).toHaveFocus();
  });

  it('can be controlled', async () => {
    const onOpenChange = vi.fn();
    const { user, rerender } = renderUi(<AccountMenu open={false} onOpenChange={onOpenChange} />);
    await user.click(trigger());
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    rerender(<AccountMenu open onOpenChange={onOpenChange} />);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});
