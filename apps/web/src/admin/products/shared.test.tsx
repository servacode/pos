import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PercentIcon } from '@serva/ui';
import { DeltaPill, DropZone, EmptyState } from './shared';

describe('the products pages’ shared pieces', () => {
  it('EmptyState says what is missing and offers the next step', () => {
    render(<EmptyState icon={PercentIcon} title="لا شيء هنا." description="ابدأ بإضافة أول عنصر." />);
    expect(screen.getByText('لا شيء هنا.')).toBeInTheDocument();
    expect(screen.getByText('ابدأ بإضافة أول عنصر.')).toBeInTheDocument();
  });

  it('DropZone takes a picked file and a dropped one the same way, and one at a time unless it is multiple', async () => {
    const onFiles = vi.fn();
    render(
      <DropZone
        title="اختر ملفاً"
        hint="حتى 15 ميغابايت"
        accept=".csv"
        ariaLabel="الملف"
        onFiles={onFiles}
      />,
    );
    const a = new File(['a'], 'a.csv', { type: 'text/csv' });
    const b = new File(['b'], 'b.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('الملف'), a);
    expect(onFiles).toHaveBeenLastCalledWith([a]);
    fireEvent.drop(screen.getByText('اختر ملفاً').closest('label')!, { dataTransfer: { files: [a, b] } });
    expect(onFiles).toHaveBeenLastCalledWith([a]);
  });

  it('DropZone takes several files when asked, and nothing while busy', () => {
    const onFiles = vi.fn();
    const { rerender } = render(
      <DropZone title="الصور" accept="image/*" ariaLabel="الصور" multiple onFiles={onFiles} />,
    );
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    fireEvent.drop(screen.getByText('الصور').closest('label')!, { dataTransfer: { files: [a, b] } });
    expect(onFiles).toHaveBeenLastCalledWith([a, b]);
    onFiles.mockClear();
    rerender(
      <DropZone
        title="الصور"
        accept="image/*"
        ariaLabel="الصور"
        multiple
        disabled
        busyText="نقرأ…"
        onFiles={onFiles}
      />,
    );
    fireEvent.drop(screen.getByText('الصور').closest('label')!, { dataTransfer: { files: [a] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText('نقرأ…')).toBeInTheDocument();
  });

  it('DeltaPill gives a rise and a fall the same shape with a word for a screen reader', () => {
    render(
      <>
        <DeltaPill rise>250</DeltaPill>
        <DeltaPill rise={false}>250</DeltaPill>
      </>,
    );
    expect(screen.getByText('ارتفع').parentElement).toHaveClass('rounded-full', 'border');
    expect(screen.getByText('انخفض').parentElement).toHaveClass('rounded-full', 'border');
  });
});
