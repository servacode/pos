import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceRevoked } from './DeviceRevoked';

describe('a suspended device', () => {
  it('says so, and links again once everything was sent', async () => {
    const onForget = vi.fn(async () => undefined);
    render(<DeviceRevoked deviceName="كاشير 2" pending={0} online onForget={onForget} />);

    expect(screen.getByRole('heading', { name: 'أُوقف هذا الجهاز' })).toBeInTheDocument();
    expect(screen.getByText(/«كاشير 2»/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'اربط هذا الجهاز من جديد' }));
    expect(onForget).toHaveBeenCalledOnce();
  });

  it('keeps unsent documents unless the owner confirms dropping them', async () => {
    const onForget = vi.fn(async () => undefined);
    render(<DeviceRevoked deviceName="كاشير 2" pending={3} online={false} onForget={onForget} />);

    expect(screen.getByText(/3 مستندات لم تُرسل/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اربط هذا الجهاز من جديد' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'أعد الربط دون إرسال ما بقي' }));
    expect(onForget).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /تأكيد: احذف 3 مستندات دون إرسال/ }));
    expect(onForget).toHaveBeenCalledOnce();
  });
});
