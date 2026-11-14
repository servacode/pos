import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DateField } from './DateField';
import { parseDayInput, slashDay } from './dates';

function Harness({ start = '2026-11-13', required = false }: { start?: string; required?: boolean }) {
  const [day, setDay] = useState(start);
  return (
    <>
      <DateField label="من" value={day} max="2026-12-31" required={required} onChange={setDay} />
      <output aria-label="iso">{day}</output>
    </>
  );
}

describe('day helpers', () => {
  it('writes day first and reads every common form', () => {
    expect(slashDay('2026-11-13')).toBe('13/11/2026');
    expect(slashDay('')).toBe('');
    expect(parseDayInput('13/11/2026')).toBe('2026-11-13');
    expect(parseDayInput('١٣-١١-٢٠٢٦')).toBe('2026-11-13');
    expect(parseDayInput('1 5 2026')).toBe('2026-05-01');
    expect(parseDayInput('2026-11-13')).toBe('2026-11-13');
    expect(parseDayInput('31/02/2026')).toBeNull();
    expect(parseDayInput('11/13/26')).toBeNull();
    expect(parseDayInput('')).toBeNull();
    expect(parseDayInput('01102026')).toBe('2026-10-01');
    expect(parseDayInput('٠١١٠٢٠٢٦')).toBe('2026-10-01');
    expect(parseDayInput('31022026')).toBeNull();
    expect(parseDayInput('0110202')).toBeNull();
  });

  it('reads DDMMYYYY digits typed without slashes and says when text cannot be read', async () => {
    const user = userEvent.setup();
    render(<Harness required />);
    const field = screen.getByLabelText('من');
    await user.clear(field);
    await user.type(field, '01102026');
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-10-01');
    await user.tab();
    expect(field).toHaveValue('01/10/2026');
    await user.clear(field);
    await user.type(field, '9999');
    await user.tab();
    expect(screen.getByText(/اكتب تاريخاً صحيحاً/)).toBeInTheDocument();
  });
});

describe('DateField', () => {
  it('shows the day as dd/mm/yyyy and keeps ISO as the value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText('من');
    expect(field).toHaveValue('13/11/2026');
    await user.clear(field);
    await user.type(field, '٠١/١٠/٢٠٢٦');
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-10-01');
  });

  it('still takes an ISO day, as the calendar and the tests send it', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-10-15' } });
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-10-15');
    expect(screen.getByLabelText('من')).toHaveValue('2026-10-15');
  });

  it('says what is wrong with a day that is not one, and with one past the limit', async () => {
    const user = userEvent.setup();
    render(<Harness required />);
    const field = screen.getByLabelText('من');
    await user.clear(field);
    await user.type(field, '45/13/2026');
    await user.tab();
    expect(screen.getByText(/اكتب تاريخاً صحيحاً/)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '01/01/2027');
    await user.tab();
    expect(screen.getByText(/اكتب تاريخاً صحيحاً/)).toBeInTheDocument();
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-11-13');
  });

  it('an emptied optional field gives an empty value; a required one keeps the day', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.clear(screen.getByLabelText('من'));
    expect(screen.getByLabelText('iso')).toHaveTextContent('');
    unmount();
    render(<Harness required />);
    await user.clear(screen.getByLabelText('من'));
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-11-13');
  });

  it('takes the day from the native calendar and offers a button for it', () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('button', { name: 'التقويم (من)' })).toBeInTheDocument();
    const native = container.querySelector('input[type="date"]')!;
    fireEvent.change(native, { target: { value: '2026-09-09' } });
    expect(screen.getByLabelText('iso')).toHaveTextContent('2026-09-09');
    expect(screen.getByLabelText('من')).toHaveValue('09/09/2026');
  });
});
