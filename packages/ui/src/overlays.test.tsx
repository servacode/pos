import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_HEIGHT, DensityProvider } from './context';
import { Dialog, Sheet } from './Dialog';
import { renderUi } from './test/render';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function ConfirmDelete({ onSecond }: { onSecond?: () => void }) {
  const [open, setOpen] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        احذف
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="احذف المنتج؟"
        description="لن يظهر في البيع بعد الآن."
        actions={
          <button
            type="button"
            onClick={() => {
              setSecond(true);
              onSecond?.();
            }}
          >
            افتح نافذة ثانية
          </button>
        }
      >
        <input aria-label="سبب الحذف" />
      </Dialog>
      <Dialog open={second} onOpenChange={setSecond} title="نافذة ثانية" />
    </>
  );
}

describe('Dialog', () => {
  it('opens as a modal dialog named by its title and described by its text', async () => {
    const { user } = renderUi(<ConfirmDelete />);
    await user.click(screen.getByRole('button', { name: 'احذف' }));

    const dialog = await screen.findByRole('dialog', { name: 'احذف المنتج؟' });
    expect(dialog).toHaveAccessibleDescription('لن يظهر في البيع بعد الآن.');
    expect(dialog).toHaveAttribute('dir', 'rtl');
  });

  it('closes with Esc and with its close button, but not with a click outside', async () => {
    const { user } = renderUi(<ConfirmDelete />);
    await user.click(screen.getByRole('button', { name: 'احذف' }));
    await screen.findByRole('dialog');

    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'احذف' }));
    await user.click(await screen.findByRole('button', { name: 'أغلق' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refuses a dialog over a dialog (tab 14)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = renderUi(<ConfirmDelete />);
    await user.click(screen.getByRole('button', { name: 'احذف' }));
    await user.click(await screen.findByRole('button', { name: 'افتح نافذة ثانية' }));

    expect(screen.queryByRole('dialog', { name: 'نافذة ثانية' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no dialog over a dialog'));
  });

  it('writes its description at 16 on the cashier and 14 on the admin (tab 14 › الخط)', async () => {
    const description = 'سيُلغى البيع كله.';
    const dialog = <Dialog open onOpenChange={() => {}} title="ألغِ البيع؟" description={description} />;
    const cashier = renderUi(dialog, { density: 'touch' });
    expect(await screen.findByText(description)).toHaveClass('text-base');
    cashier.unmount();

    renderUi(dialog);
    expect(await screen.findByText(description)).toHaveClass('text-sm');
  });
});

describe('Sheet', () => {
  function Payment({ side }: { side?: 'end' | 'bottom' }) {
    const [open, setOpen] = useState(true);
    return (
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="الدفع"
        side={side}
        footer={<button type="button">أتمّ الدفع</button>}
      >
        <p>الباقي 90 ل.س</p>
      </Sheet>
    );
  }

  it('slides in from the inline end (the left in Arabic) with its footer action', async () => {
    renderUi(<Payment />);

    const sheet = await screen.findByRole('dialog', { name: 'الدفع' });
    expect(sheet).toHaveClass('end-0', 'motion-safe:animate-sheet-in');
    expect(screen.getByRole('button', { name: 'أتمّ الدفع' })).toBeInTheDocument();
  });

  it('becomes a bottom sheet on the phone', async () => {
    renderUi(<Payment side="bottom" />);
    expect(await screen.findByRole('dialog', { name: 'الدفع' })).toHaveClass('bottom-0', 'rounded-t-panel');
  });

  it('stays open on a click outside, so the payment is never lost by a slip', async () => {
    renderUi(<Payment />);
    await screen.findByRole('dialog');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('rounds its inner corners only once the window is wider than the panel', async () => {
    renderUi(<Payment />);
    const sheet = await screen.findByRole('dialog', { name: 'الدفع' });
    // max-w-120 is 30rem: up to that width the sheet fills the window, square; not up to 640 (sm).
    expect(sheet).toHaveClass('max-w-120', '[@media(width>30rem)]:rounded-s-panel');
    expect(sheet).not.toHaveClass('sm:rounded-s-panel');
  });

  it('writes its description at 16 on the cashier', async () => {
    renderUi(
      <Sheet open onOpenChange={() => {}} title="الدفع" description="نقداً أو بالبطاقة">
        <p>الباقي 90 ل.س</p>
      </Sheet>,
      { density: 'touch' },
    );
    expect(await screen.findByText('نقداً أو بالبطاقة')).toHaveClass('text-base');
  });
});

function SaveButton() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ message: 'حُفظ المنتج', action: { label: 'تراجع', onClick: () => undo() } })}
    >
      احفظ
    </button>
  );
}
const undo = vi.fn();

describe('Toast', () => {
  it('names what was done, without moving focus, and goes away after 4 seconds', () => {
    vi.useFakeTimers();
    renderUi(
      <ToastProvider>
        <SaveButton />
      </ToastProvider>,
    );

    const button = screen.getByRole('button', { name: 'احفظ' });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveTextContent('حُفظ المنتج');
    expect(button).toHaveFocus();

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 100));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stops counting while hovered (tab 14 › الإشعار المؤقت لا يسبق القارئ)', () => {
    vi.useFakeTimers();
    renderUi(
      <ToastProvider>
        <SaveButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));

    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 3));
    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('announces an error at once, with its tone mark, and closes from «أغلق الإشعار»', () => {
    function PrintButton() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast({ tone: 'error', message: 'لم تُطبع الفاتورة.' })}>
          اطبع
        </button>
      );
    }
    renderUi(
      <ToastProvider>
        <PrintButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'اطبع' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('لم تُطبع الفاتورة.');
    expect(alert.querySelector('svg')).toHaveClass('lucide-circle-alert', 'fill-danger');

    fireEvent.click(screen.getByRole('button', { name: 'أغلق الإشعار' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers «تراجع» when the action can be undone', () => {
    renderUi(
      <ToastProvider>
        <SaveButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));
    fireEvent.click(screen.getByRole('button', { name: 'تراجع' }));

    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sizes its buttons by the density, 48 under a finger on the admin', () => {
    renderUi(
      <ToastProvider>
        <SaveButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(screen.getByRole('status')).toHaveClass('text-sm');
    expect(screen.getByRole('button', { name: 'تراجع' })).toHaveClass(
      ...CONTROL_HEIGHT.comfortable.split(' '),
      'rounded-control',
    );
    expect(screen.getByRole('button', { name: 'أغلق الإشعار' })).toHaveClass(
      'size-10',
      'pointer-coarse:size-12',
      'rounded-control',
    );
  });

  it('takes the density of the screen that raised it: 56 and text at 16 on the cashier', () => {
    // The provider sits at the app's root, outside the cashier's touch density.
    renderUi(
      <ToastProvider>
        <DensityProvider density="touch">
          <SaveButton />
        </DensityProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'احفظ' }));

    expect(screen.getByRole('status')).toHaveClass('text-base');
    expect(screen.getByRole('button', { name: 'تراجع' })).toHaveClass(CONTROL_HEIGHT.touch);
    expect(screen.getByRole('button', { name: 'أغلق الإشعار' })).toHaveClass('size-14');
  });
});
