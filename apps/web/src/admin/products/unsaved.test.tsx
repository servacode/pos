import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUnsavedGuard } from './unsaved';

function Page({ active }: { active: boolean }) {
  useUnsavedGuard(active);
  return <a href="/categories">التصنيفات</a>;
}

afterEach(() => vi.restoreAllMocks());

describe('useUnsavedGuard', () => {
  it('asks before a link is followed while there are unsaved edits, and stays when refused', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const click = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener('click', click);
    render(<Page active />);
    await userEvent.click(screen.getByRole('link'));
    expect(confirm).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', click);
  });

  it('lets the link through when nothing is edited', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    render(<Page active={false} />);
    await userEvent.click(screen.getByRole('link'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks on the browser Back button, and puts the page back when refused', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const push = vi.spyOn(window.history, 'pushState');
    render(<Page active />);
    expect(push).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('adds no history entry and asks nothing when nothing is edited', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const push = vi.spyOn(window.history, 'pushState');
    render(<Page active={false} />);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(push).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
