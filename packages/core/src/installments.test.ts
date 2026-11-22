import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  buildSchedule,
  checkTerms,
  daysLate,
  DEFAULT_INSTALMENT_SETTINGS,
  dueDateOf,
  defaultFirstDueDate,
  instalmentSettingsOf,
  instalmentState,
  markupBpFor,
  markupFor,
  minDownPayment,
  numberToArabicWords,
  reminderText,
} from './installments';

const settings = instalmentSettingsOf({ enabled: true });

describe('markup', () => {
  it('takes the band a count falls in, and the top band for a count over every band', () => {
    const bands = DEFAULT_INSTALMENT_SETTINGS.markupBands;
    expect(markupBpFor(1, bands)).toBe(500);
    expect(markupBpFor(3, bands)).toBe(500);
    expect(markupBpFor(4, bands)).toBe(1000);
    expect(markupBpFor(6, bands)).toBe(1000);
    expect(markupBpFor(7, bands)).toBe(2000);
    expect(markupBpFor(12, bands)).toBe(2000);
    expect(markupBpFor(24, bands)).toBe(2000);
    expect(markupBpFor(5, [])).toBe(0);
    // Bands given out of order are read in order
    expect(
      markupBpFor(2, [
        { upToCount: 12, bp: 2000 },
        { upToCount: 3, bp: 500 },
      ]),
    ).toBe(500);
  });

  it('is a share of what is left after the down payment, half away from zero', () => {
    expect(markupFor(80_000, 3, settings)).toBe(4_000);
    expect(markupFor(80_001, 6, settings)).toBe(8_000);
    expect(markupFor(5, 3, settings)).toBe(0);
    expect(markupFor(10, 3, settings)).toBe(1);
    expect(markupFor(-5, 3, settings)).toBe(0);
  });

  it('asks the store’s minimum down payment, rounded up, never above the total', () => {
    expect(minDownPayment(100_000, settings)).toBe(20_000);
    expect(minDownPayment(101, settings)).toBe(21);
    expect(minDownPayment(100, { ...settings, minDownBp: 10_000 })).toBe(100);
    expect(minDownPayment(100, { ...settings, minDownBp: 0 })).toBe(0);
  });

  it('fills what the owner never chose from the defaults', () => {
    expect(instalmentSettingsOf(null)).toEqual(DEFAULT_INSTALMENT_SETTINGS);
    expect(instalmentSettingsOf(undefined).enabled).toBe(false);
    expect(instalmentSettingsOf({ enabled: true, minDownBp: 3000 })).toMatchObject({
      enabled: true,
      minDownBp: 3000,
      maxCount: 12,
    });
  });
});

describe('dates', () => {
  it('monthly keeps the first day’s number and never drifts', () => {
    expect(dueDateOf('2026-01-31', 'monthly', 0)).toBe('2026-01-31');
    expect(dueDateOf('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(dueDateOf('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(dueDateOf('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
    expect(dueDateOf('2026-12-15', 'monthly', 2)).toBe('2027-02-15');
  });
  it('weekly is seven days, biweekly fourteen', () => {
    expect(dueDateOf('2026-11-01', 'weekly', 2)).toBe('2026-11-15');
    expect(dueDateOf('2026-11-01', 'biweekly', 2)).toBe('2026-11-29');
  });
});

describe('buildSchedule', () => {
  const base = {
    totalMinor: 100_000,
    downPaymentMinor: 20_000,
    count: 3,
    frequency: 'monthly' as const,
    firstDueDate: '2026-11-30',
    markupMinor: 4_000,
  };

  it('splits the financed amount equally and the last takes the difference', () => {
    const s = buildSchedule({ ...base, markupMinor: 4_001 });
    expect(s).toMatchObject({ principalMinor: 80_000, markupMinor: 4_001, financedMinor: 84_001 });
    expect(s.instalments.map((i) => i.amountMinor)).toEqual([28_000, 28_000, 28_001]);
    expect(s.instalments.map((i) => i.dueDate)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30']);
  });

  it('rounds each instalment down to the step and the last takes what is left', () => {
    const s = buildSchedule({ ...base, markupMinor: 4_150, roundingStepMinor: 1000 });
    expect(s.instalments.map((i) => i.amountMinor)).toEqual([28_000, 28_000, 28_150]);
    // A step of 0 or 1 is exact
    expect(buildSchedule({ ...base, roundingStepMinor: 0 }).instalments).toHaveLength(3);
  });

  it('takes the dates it was given for custom plans', () => {
    const s = buildSchedule({
      ...base,
      frequency: 'custom',
      customDates: ['2026-11-30', '2026-12-05', '2027-02-01'],
    });
    expect(s.instalments.map((i) => i.dueDate)).toEqual(['2026-11-30', '2026-12-05', '2027-02-01']);
    expect(() => buildSchedule({ ...base, frequency: 'custom', customDates: ['2026-11-30'] })).toThrow(
      'اكتب تاريخاً لكل قسط.',
    );
    expect(() => buildSchedule({ ...base, frequency: 'custom' })).toThrow('اكتب تاريخاً لكل قسط.');
    expect(() =>
      buildSchedule({
        ...base,
        frequency: 'custom',
        customDates: ['2026-11-30', '2026-11-30', '2027-01-01'],
      }),
    ).toThrow('تواريخ الأقساط تتصاعد.');
  });

  it('refuses terms that cannot hold, in words the cashier can fix', () => {
    expect(() => buildSchedule({ ...base, count: 0 })).toThrow('عدد الأقساط');
    expect(() => buildSchedule({ ...base, count: 1.5 })).toThrow('عدد الأقساط');
    expect(() => buildSchedule({ ...base, downPaymentMinor: -1 })).toThrow('الدفعة الأولى');
    expect(() => buildSchedule({ ...base, downPaymentMinor: 100_000 })).toThrow('الدفعة الأولى');
    expect(() => buildSchedule({ ...base, markupMinor: -1 })).toThrow('رسم التقسيط');
    expect(() => buildSchedule({ ...base, count: 90_000 })).toThrow('القسط أقل');
  });

  it('always adds up to the financed amount, with every instalment positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(0, 1, 100, 1000),
        fc.constantFrom('monthly', 'biweekly', 'weekly'),
        (total, downPct, markup, count, step, frequency) => {
          const down = Math.floor((total * downPct) / 100);
          if (total - down + markup < count * Math.max(1, step)) return;
          const s = buildSchedule({
            totalMinor: total,
            downPaymentMinor: down,
            count,
            frequency,
            firstDueDate: '2026-11-30',
            markupMinor: markup,
            roundingStepMinor: step,
          });
          expect(s.instalments.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(total - down + markup);
          expect(s.instalments.every((i) => i.amountMinor > 0)).toBe(true);
          expect(s.instalments).toHaveLength(count);
        },
      ),
    );
  });
});

describe('checkTerms', () => {
  const terms = { totalMinor: 100_000, downPaymentMinor: 20_000, count: 6, firstDueDate: '2026-12-01' };
  it('accepts terms within the store’s rules', () => {
    expect(checkTerms(terms, settings, '2026-11-17')).toEqual([]);
  });
  it('names what is wrong', () => {
    expect(checkTerms({ ...terms, count: 13 }, settings, '2026-11-17')).toEqual(['أكثر عدد للأقساط 12.']);
    expect(checkTerms({ ...terms, downPaymentMinor: 5_000 }, settings, '2026-11-17')).toEqual([
      'الدفعة الأولى أقل من الحد الأدنى.',
    ]);
    expect(checkTerms({ ...terms, firstDueDate: '2026-11-01' }, settings, '2026-11-17')).toEqual([
      'تاريخ أول قسط مضى.',
    ]);
    expect(checkTerms({ ...terms, firstDueDate: '2027-06-01' }, settings, '2026-11-17')).toEqual([
      'أول قسط بعيد أكثر من اللازم.',
    ]);
  });
  it('lets a manager lower the down payment', () => {
    expect(
      checkTerms({ ...terms, downPaymentMinor: 0 }, settings, '2026-11-17', { minDownWaived: true }),
    ).toEqual([]);
  });
});

describe('allocatePayment', () => {
  const open = [
    { id: 'b', dueDate: '2026-12-01', amountMinor: 100, paidMinor: 0 },
    { id: 'a', dueDate: '2026-11-01', amountMinor: 100, paidMinor: 30 },
    { id: 'c', dueDate: '2027-01-01', amountMinor: 100, paidMinor: 0 },
    { id: 'z', dueDate: '2026-11-01', amountMinor: 50, paidMinor: 50 },
  ];
  it('fills the oldest first, partly paid ones for what is left', () => {
    expect(allocatePayment(open, 70)).toEqual({
      allocations: [{ installmentId: 'a', amountMinor: 70 }],
      unallocatedMinor: 0,
    });
    expect(allocatePayment(open, 120)).toEqual({
      allocations: [
        { installmentId: 'a', amountMinor: 70 },
        { installmentId: 'b', amountMinor: 50 },
      ],
      unallocatedMinor: 0,
    });
  });
  it('leaves what is more than the plan unallocated, and nothing for nothing', () => {
    expect(allocatePayment(open, 1_000).unallocatedMinor).toBe(1_000 - 70 - 100 - 100);
    expect(allocatePayment(open, 0)).toEqual({ allocations: [], unallocatedMinor: 0 });
    expect(allocatePayment(open, -5)).toEqual({ allocations: [], unallocatedMinor: 0 });
    expect(allocatePayment([], 10)).toEqual({ allocations: [], unallocatedMinor: 10 });
  });
  it('breaks a tie of days by id', () => {
    const tie = [
      { id: 'y', dueDate: '2026-11-01', amountMinor: 10, paidMinor: 0 },
      { id: 'x', dueDate: '2026-11-01', amountMinor: 10, paidMinor: 0 },
    ];
    expect(allocatePayment(tie, 10).allocations).toEqual([{ installmentId: 'x', amountMinor: 10 }]);
  });
});

describe('state and reminders', () => {
  const item = (dueDate: string, paidMinor = 0) => ({ dueDate, amountMinor: 100, paidMinor });
  it('is derived from the day, never stored', () => {
    expect(instalmentState(item('2026-11-17', 100), '2026-11-20')).toBe('paid');
    expect(instalmentState(item('2026-11-17'), '2026-11-20')).toBe('late');
    expect(instalmentState(item('2026-11-17', 40), '2026-11-20')).toBe('late');
    expect(instalmentState(item('2026-11-20'), '2026-11-20')).toBe('due_today');
    expect(instalmentState(item('2026-11-25', 40), '2026-11-20')).toBe('partial');
    expect(instalmentState(item('2026-11-25'), '2026-11-20')).toBe('upcoming');
  });
  it('counts the days late, never below zero', () => {
    expect(daysLate('2026-11-17', '2026-11-20')).toBe(3);
    expect(daysLate('2026-11-20', '2026-11-20')).toBe(0);
    expect(daysLate('2026-11-25', '2026-11-20')).toBe(0);
  });
  it('words the reminder for before, on and after the day', () => {
    const v = { name: 'أبو خالد', amount: '28,000', due: '2026-11-30', no: 1, of: 3, store: 'متجر' };
    expect(reminderText('before', v)).toContain('يستحق بتاريخ 2026-11-30');
    expect(reminderText('due', v)).toContain('مستحق اليوم');
    expect(reminderText('late', { ...v, daysLate: 3 })).toContain('(تأخر 3 يوماً)');
    expect(reminderText('late', v)).not.toContain('تأخر');
  });
});

describe('numberToArabicWords', () => {
  it('writes the numbers a note carries', () => {
    expect(numberToArabicWords(0)).toBe('صفر');
    expect(numberToArabicWords(1)).toBe('واحد');
    expect(numberToArabicWords(2)).toBe('اثنان');
    expect(numberToArabicWords(10)).toBe('عشرة');
    expect(numberToArabicWords(11)).toBe('أحد عشر');
    expect(numberToArabicWords(21)).toBe('واحد وعشرون');
    expect(numberToArabicWords(100)).toBe('مئة');
    expect(numberToArabicWords(101)).toBe('مئة وواحد');
    expect(numberToArabicWords(250)).toBe('مئتان وخمسون');
    expect(numberToArabicWords(1000)).toBe('ألف');
    expect(numberToArabicWords(2000)).toBe('ألفان');
    expect(numberToArabicWords(3000)).toBe('ثلاثة آلاف');
    expect(numberToArabicWords(11_000)).toBe('أحد عشر ألفاً');
    expect(numberToArabicWords(28_000)).toBe('ثمانية وعشرون ألفاً');
    expect(numberToArabicWords(1_250_000)).toBe('مليون ومئتان وخمسون ألفاً');
    expect(numberToArabicWords(2_000_000)).toBe('مليونان');
    expect(numberToArabicWords(5_000_000)).toBe('خمسة ملايين');
    expect(numberToArabicWords(1_000_000)).toBe('مليون');
    expect(numberToArabicWords(1_500_000_000)).toBe('مليار وخمسمئة مليون');
    expect(numberToArabicWords(3_000_000_000_000)).toBe('ثلاثة تريليونات');
    expect(numberToArabicWords(2_000_000_000)).toBe('ملياران');
    expect(numberToArabicWords(12_000_000_000_000)).toBe('اثنا عشر تريليوناً');
  });
  it('refuses what is not a whole number from zero', () => {
    expect(() => numberToArabicWords(-1)).toThrow(RangeError);
    expect(() => numberToArabicWords(1.5)).toThrow(RangeError);
  });
});

describe('the default first due date', () => {
  it('is one period after the sale: 7 days weekly, 14 biweekly, a month monthly', () => {
    expect(defaultFirstDueDate('2026-11-17', 'weekly')).toBe('2026-11-24');
    expect(defaultFirstDueDate('2026-11-17', 'biweekly')).toBe('2026-12-01');
    expect(defaultFirstDueDate('2026-11-17', 'monthly')).toBe('2026-12-17');
    expect(defaultFirstDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
  });
});
