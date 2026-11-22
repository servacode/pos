import { describe, expect, it } from 'vitest';
import {
  controlledRegisterQuery,
  pharmacySettingsSchema,
  DEFAULT_PHARMACY_SETTINGS,
} from './contracts/pharmacy';
import { shortageRequestInput } from './contracts/pharmacy';
import {
  addMonthsISO,
  allocateFefo,
  batchState,
  daysBetweenISO,
  expiredAction,
  isAlternative,
  overStock,
  sameBatch,
  uncoveredAction,
  medicineReturnPolicy,
  medicineReturnRule,
  missingPrescription,
  pickBatch,
  prescriptionNeed,
  usesAutoBatch,
} from './pharmacy';

describe('pickBatch: nearest expiry first, never an expired one', () => {
  const a = { batchNo: 'A-01', expiry: '2026-11-01' };
  const b = { batchNo: 'B-07', expiry: '2027-03-01' };
  const old = { batchNo: 'Z-00', expiry: '2026-01-01' };

  it('knows nothing about an item with no batches', () => {
    expect(pickBatch(null, '2026-10-30')).toEqual({ kind: 'none' });
    expect(pickBatch(undefined, '2026-10-30')).toEqual({ kind: 'none' });
    expect(pickBatch([], '2026-10-30')).toEqual({ kind: 'none' });
  });

  it('takes the nearest batch that is still good, whatever order they come in', () => {
    expect(pickBatch([b, a], '2026-10-30')).toEqual({ kind: 'ok', batch: a });
    expect(pickBatch([old, b, a], '2026-10-30')).toEqual({ kind: 'ok', batch: a });
  });

  it('a batch is good through its own date, and not the day after', () => {
    expect(pickBatch([a], '2026-11-01')).toEqual({ kind: 'ok', batch: a });
    expect(pickBatch([a, b], '2026-11-02')).toEqual({ kind: 'ok', batch: b });
  });

  it('refuses when every batch has expired, naming the latest', () => {
    expect(pickBatch([old, a], '2026-12-01')).toEqual({ kind: 'expired', latest: '2026-11-01' });
  });

  it('does not change the list it was given', () => {
    const list = [b, a];
    pickBatch(list, '2026-10-30');
    expect(list).toEqual([b, a]);
  });
});

describe('what a cart asks for in prescription details', () => {
  it('asks for nothing for ordinary items', () => {
    expect(prescriptionNeed([{}, { requiresPrescription: false, controlled: false }], null)).toEqual({
      asks: false,
      required: [],
      shown: [],
    });
    expect(prescriptionNeed([], { prescription: 'required' }).asks).toBe(false);
  });

  it('asks for the number and the doctor of a prescription medicine, required only when the store says so', () => {
    expect(prescriptionNeed([{ requiresPrescription: true }], { prescription: 'optional' })).toEqual({
      asks: true,
      required: [],
      shown: ['ref', 'doctor'],
    });
    expect(prescriptionNeed([{ requiresPrescription: true }], null).required).toEqual([]);
    expect(prescriptionNeed([{ requiresPrescription: true }], undefined).required).toEqual([]);
    expect(prescriptionNeed([{ requiresPrescription: true }], { prescription: 'required' }).required).toEqual(
      ['ref', 'doctor'],
    );
  });

  it('always asks for all four of a controlled drug, whatever the store says', () => {
    const all = ['ref', 'doctor', 'patientName', 'patientId'];
    for (const settings of [
      null,
      { prescription: 'optional' as const },
      { prescription: 'required' as const },
    ]) {
      const need = prescriptionNeed([{ requiresPrescription: true }, { controlled: true }], settings);
      expect(need).toEqual({ asks: true, required: all, shown: all });
    }
  });

  it('lists the required fields still empty, treating blanks as empty', () => {
    const need = prescriptionNeed([{ controlled: true }], null);
    expect(missingPrescription(need, null)).toEqual(['ref', 'doctor', 'patientName', 'patientId']);
    expect(missingPrescription(need, undefined)).toHaveLength(4);
    expect(
      missingPrescription(need, { ref: 'RX', doctor: '  ', patientName: null, patientId: '01' }),
    ).toEqual(['doctor', 'patientName']);
    expect(missingPrescription(need, { ref: 'RX', doctor: 'د', patientName: 'ل', patientId: '01' })).toEqual(
      [],
    );
    expect(missingPrescription(prescriptionNeed([{ requiresPrescription: true }], null), null)).toEqual([]);
  });
});

describe('the batch setting', () => {
  it('is on for any store with pharmacy settings unless it was turned off, and off with none', () => {
    expect(usesAutoBatch(null)).toBe(false);
    expect(usesAutoBatch(undefined)).toBe(false);
    expect(usesAutoBatch({ prescription: 'optional' })).toBe(true);
    expect(usesAutoBatch({ prescription: 'optional', autoBatch: true })).toBe(true);
    expect(usesAutoBatch({ prescription: 'optional', autoBatch: false })).toBe(false);
  });
});

describe('the medicine return rule', () => {
  const plain = { medicine: false, controlled: false };
  const medicine = { medicine: true, controlled: false };
  const controlled = { medicine: true, controlled: true };
  const base = { prescription: 'optional' } as const;

  it('defaults to sealed boxes only', () => {
    expect(medicineReturnPolicy(base)).toBe('sealed');
    expect(medicineReturnPolicy(null)).toBe('sealed');
    expect(medicineReturnRule(base, medicine)).toEqual({ kind: 'sealed' });
  });

  it('leaves a store with no pharmacy settings, and a non-medicine, alone', () => {
    expect(medicineReturnRule(null, controlled)).toEqual({ kind: 'free' });
    expect(medicineReturnRule(undefined, medicine)).toEqual({ kind: 'free' });
    expect(medicineReturnRule({ ...base, returns: 'none' }, plain)).toEqual({ kind: 'free' });
  });

  it('refuses every medicine under «لا مرتجع», and takes any under «مسموح»', () => {
    expect(medicineReturnRule({ ...base, returns: 'none' }, medicine).kind).toBe('blocked');
    expect(medicineReturnRule({ ...base, returns: 'allowed' }, medicine)).toEqual({ kind: 'free' });
  });

  it('never takes a controlled drug back unless the store allows it explicitly', () => {
    for (const returns of ['none', 'sealed', 'allowed'] as const) {
      expect(medicineReturnRule({ ...base, returns }, controlled).kind).toBe('blocked');
    }
    expect(medicineReturnRule({ ...base, returns: 'none', controlledReturns: false }, controlled).kind).toBe(
      'blocked',
    );
    expect(medicineReturnRule({ ...base, controlledReturns: true }, controlled)).toEqual({ kind: 'sealed' });
    expect(medicineReturnRule({ ...base, returns: 'none', controlledReturns: true }, controlled)).toEqual({
      kind: 'sealed',
    });
    expect(medicineReturnRule({ ...base, returns: 'allowed', controlledReturns: true }, controlled)).toEqual({
      kind: 'free',
    });
  });
});

describe('the pharmacy contracts', () => {
  it('accepts only the two prescription modes, and defaults to optional', () => {
    expect(pharmacySettingsSchema.safeParse({ prescription: 'required' }).success).toBe(true);
    expect(pharmacySettingsSchema.safeParse({ prescription: 'optional' }).success).toBe(true);
    expect(pharmacySettingsSchema.safeParse({ prescription: 'maybe' }).success).toBe(false);
    expect(DEFAULT_PHARMACY_SETTINGS).toEqual({ prescription: 'optional' });
    const full = { prescription: 'optional', returns: 'none', controlledReturns: true, autoBatch: false };
    expect(pharmacySettingsSchema.parse(full)).toEqual(full);
    expect(pharmacySettingsSchema.safeParse({ prescription: 'optional', returns: 'x' }).success).toBe(false);
  });

  it('takes a register window that does not run backwards', () => {
    expect(controlledRegisterQuery.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(controlledRegisterQuery.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(true);
    const backwards = controlledRegisterQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' });
    expect(backwards.success).toBe(false);
    expect(controlledRegisterQuery.safeParse({ from: 'x', to: '2026-10-01' }).success).toBe(false);
  });
});

describe('batch state and FEFO allocation', () => {
  const today = '2026-10-30';
  const b = (batchNo: string | null, expiry: string | null, qty: number, blocked = false) => ({
    batchNo,
    expiry,
    qty,
    blocked,
  });

  it('tells a batch that is good, empty, blocked or expired (good through its own date)', () => {
    expect(batchState(b('A', '2026-10-30', 5), today)).toBe('ok');
    expect(batchState(b('A', '2026-10-29', 5), today)).toBe('expired');
    expect(batchState(b('A', null, 5), today)).toBe('ok');
    expect(batchState(b('A', '2027-01-01', 0), today)).toBe('empty');
    expect(batchState(b('A', '2027-01-01', -3), today)).toBe('empty');
    expect(batchState(b('A', '2027-01-01', 5, true), today)).toBe('blocked');
    expect(batchState({ batchNo: 'A', expiry: '2027-01-01', qty: 5 }, today)).toBe('ok');
  });

  it('takes the earliest expiry first from one batch when it is enough', () => {
    const r = allocateFefo([b('C', '2027-03-01', 9000), b('B', '2026-11-15', 5000)], 3000, today);
    expect(r.allocations).toEqual([{ batchNo: 'B', expiry: '2026-11-15', qty: 3000 }]);
    expect(r.uncovered).toBe(0);
    expect(r.remaining.find((x) => x.batchNo === 'B')!.qty).toBe(2000);
  });

  it('splits a line over batches when the first is not enough', () => {
    const r = allocateFefo([b('C', '2027-03-01', 9000), b('B', '2026-11-15', 5000)], 8000, today);
    expect(r.allocations).toEqual([
      { batchNo: 'B', expiry: '2026-11-15', qty: 5000 },
      { batchNo: 'C', expiry: '2027-03-01', qty: 3000 },
    ]);
    expect(r.uncovered).toBe(0);
  });

  it('skips expired, blocked and empty batches, and reports what is left uncovered and why', () => {
    const r = allocateFefo(
      [
        b('A', '2026-10-25', 10000),
        b('Z', '2027-05-01', 2000, true),
        b('E', '2027-01-01', 0),
        b('B', '2026-12-01', 1500),
      ],
      4000,
      today,
    );
    expect(r.allocations).toEqual([{ batchNo: 'B', expiry: '2026-12-01', qty: 1500 }]);
    expect(r).toMatchObject({ uncovered: 2500, expiredQty: 10000, blockedQty: 2000 });
  });

  it('gives nothing, all uncovered, when there is no valid batch; and nothing for a zero or negative quantity', () => {
    expect(allocateFefo([], 3000, today)).toMatchObject({ allocations: [], uncovered: 3000 });
    expect(allocateFefo([b('A', '2027-01-01', 5000)], 0, today)).toMatchObject({
      allocations: [],
      uncovered: 0,
    });
    expect(allocateFefo([b('A', '2027-01-01', 5000)], -5, today).allocations).toEqual([]);
  });

  it('never takes from a batch that is empty or oversold (a negative balance), so an allocation is never negative', () => {
    const r = allocateFefo(
      [b('N', null, -4000), b('Z', '2027-01-01', 0), b('B', '2027-02-01', 1500)],
      3000,
      today,
    );
    expect(r.allocations).toEqual([{ batchNo: 'B', expiry: '2027-02-01', qty: 1500 }]);
    expect(r.uncovered).toBe(1500);
  });

  it('orders a batch with no date last and equal dates by number, and does not change its input', () => {
    const input = [
      b('Z', null, 1000),
      b('M', '2027-01-01', 1000),
      b('A', '2027-01-01', 1000),
      b(null, '2027-01-01', 1000),
    ];
    const r = allocateFefo(input, 4000, today);
    expect(r.allocations.map((a) => a.batchNo)).toEqual([null, 'A', 'M', 'Z']);
    expect(input.map((x) => x.qty)).toEqual([1000, 1000, 1000, 1000]);
  });

  it('orders the same whatever order the batches arrive in', () => {
    const dated = b('A', '2027-01-01', 1000);
    const undated = b('Z', null, 1000);
    for (const list of [
      [dated, undated],
      [undated, dated],
    ]) {
      expect(allocateFefo(list, 2000, today).allocations.map((a) => a.batchNo)).toEqual(['A', 'Z']);
    }
    const unnamed = b(null, '2027-01-01', 1000);
    const named = b('M', '2027-01-01', 1000);
    for (const list of [
      [unnamed, named],
      [named, unnamed],
    ]) {
      expect(allocateFefo(list, 2000, today).allocations.map((a) => a.batchNo)).toEqual([null, 'M']);
    }
    // A batch whose expiry is missing altogether counts as one with none
    const missing = { batchNo: 'Q', qty: 1000 } as unknown as ReturnType<typeof b>;
    expect(sameBatch(missing, { batchNo: 'Q', expiry: null })).toBe(true);
    expect(sameBatch({ batchNo: 'Q', expiry: null }, missing)).toBe(true);
  });

  it('knows the same batch by number and expiry, with no number equal to an empty one', () => {
    expect(sameBatch({ batchNo: 'A', expiry: '2027-01-01' }, { batchNo: 'A', expiry: '2027-01-01' })).toBe(
      true,
    );
    expect(sameBatch({ batchNo: 'A', expiry: '2027-01-01' }, { batchNo: 'A', expiry: '2027-02-01' })).toBe(
      false,
    );
    expect(sameBatch({ batchNo: null, expiry: null }, { batchNo: '', expiry: null })).toBe(true);
    expect(sameBatch({ batchNo: 'A', expiry: null }, { batchNo: 'B', expiry: null })).toBe(false);
  });

  it('knows a sale goes over the stock, treating no or negative stock as none, and unknown as fine', () => {
    expect(overStock(5000, 5000)).toBe(false);
    expect(overStock(5000, 5001)).toBe(true);
    expect(overStock(-2000, 1000)).toBe(true);
    expect(overStock(0, 0)).toBe(false);
    expect(overStock(null, 99999)).toBe(false);
    expect(overStock(undefined, 99999)).toBe(false);
  });

  it('blocks or asks a manager only for an item that keeps batches and has something uncovered', () => {
    expect(uncoveredAction({ prescription: 'optional', blockNoBatch: true }, true, 1000)).toBe('block');
    expect(uncoveredAction({ prescription: 'optional' }, true, 1000)).toBe('approve');
    expect(uncoveredAction(null, true, 1000)).toBe('approve');
    expect(uncoveredAction({ prescription: 'optional', blockNoBatch: true }, true, 0)).toBe('none');
    expect(uncoveredAction({ prescription: 'optional', blockNoBatch: true }, false, 1000)).toBe('none');
  });

  it('accepts the new settings and allocations in the contracts', () => {
    expect(pharmacySettingsSchema.parse({ prescription: 'optional', blockNoBatch: true })).toEqual({
      prescription: 'optional',
      blockNoBatch: true,
    });
  });
});

describe('round 38: FEFO with an expired batch a manager allowed', () => {
  const today = '2026-10-30';
  const batches = [
    { batchNo: 'OLD', expiry: '2026-09-01', qty: 5000 },
    { batchNo: 'NEW', expiry: '2027-03-01', qty: 2000 },
    { batchNo: 'MID', expiry: '2026-12-01', qty: 1000 },
  ];

  it('never takes an expired batch by default, and the nearest valid expiry goes first', () => {
    const r = allocateFefo(batches, 2500, today);
    expect(r.allocations.map((a) => [a.batchNo, a.qty])).toEqual([
      ['MID', 1000],
      ['NEW', 1500],
    ]);
    expect(r.uncovered).toBe(0);
    const over = allocateFefo(batches, 4000, today);
    expect(over.uncovered).toBe(1000);
    expect(over.expiredQty).toBe(5000);
  });

  it('takes the expired batch only after the valid ones when it is allowed', () => {
    const r = allocateFefo(batches, 4000, today, true);
    expect(r.allocations.map((a) => [a.batchNo, a.qty])).toEqual([
      ['MID', 1000],
      ['NEW', 2000],
      ['OLD', 1000],
    ]);
    expect(r.uncovered).toBe(0);
    const more = allocateFefo(batches, 6500, today, true);
    expect(more.allocations.map((a) => [a.batchNo, a.qty])).toEqual([
      ['MID', 1000],
      ['NEW', 2000],
      ['OLD', 3500],
    ]);
    expect(more.remaining.find((b) => b.batchNo === 'OLD')!.qty).toBe(1500);
  });

  it('a blocked batch is never taken, allowed or not', () => {
    const r = allocateFefo(
      [{ batchNo: 'R', expiry: '2026-09-01', qty: 5000, blocked: true }],
      1000,
      today,
      true,
    );
    expect(r.uncovered).toBe(1000);
  });
});

describe('round 38: what the till does with an expired batch', () => {
  it('follows the owner’s choice, and leaves a store that never chose to its older rule', () => {
    const issue = { uncovered: 3000, expiredQty: 5000 };
    expect(expiredAction({ prescription: 'optional', allowExpiredWithCode: true }, issue)).toBe('approve');
    expect(expiredAction({ prescription: 'optional', allowExpiredWithCode: false }, issue)).toBe('block');
    expect(
      expiredAction({ prescription: 'optional', allowExpiredWithCode: true, blockNoBatch: true }, issue),
    ).toBe('approve');
    expect(
      expiredAction({ prescription: 'optional', allowExpiredWithCode: false, blockNoBatch: false }, issue),
    ).toBe('block');
    expect(expiredAction({ prescription: 'optional' }, issue)).toBeNull();
    expect(expiredAction(null, issue)).toBeNull();
  });

  it('applies only when the expired batches are what is missing', () => {
    const on = { prescription: 'optional' as const, allowExpiredWithCode: true };
    expect(expiredAction(on, { uncovered: 0, expiredQty: 5000 })).toBeNull();
    expect(expiredAction(on, { uncovered: 3000, expiredQty: 0 })).toBeNull();
    // Short by more than the expired batches hold: another shortage, the usual rule
    expect(expiredAction(on, { uncovered: 6000, expiredQty: 5000 })).toBeNull();
  });
});

describe('round 38: alternatives by active ingredient', () => {
  const panadol = { genericName: 'باراسيتامول', strength: '500 ملغ', dosageForm: 'أقراص' };

  it('matches the same ingredient, strength and form, ignoring case, spaces and Arabic spelling', () => {
    expect(
      isAlternative(panadol, { genericName: ' باراسيتامول ', strength: '500ملغ', dosageForm: 'أقراص' }),
    ).toBe(true);
    expect(isAlternative({ genericName: 'Paracetamol' }, { genericName: 'paracetamol ' })).toBe(true);
  });

  it('refuses another strength, another form or another ingredient', () => {
    expect(isAlternative(panadol, { ...panadol, strength: '1 غ' })).toBe(false);
    expect(isAlternative(panadol, { ...panadol, dosageForm: 'شراب' })).toBe(false);
    expect(isAlternative(panadol, { ...panadol, genericName: 'إيبوبروفين' })).toBe(false);
    // The other one states no strength: it cannot be said to be the same
    expect(isAlternative(panadol, { genericName: 'باراسيتامول', dosageForm: 'أقراص' })).toBe(false);
  });

  it('asks only what the asked-for item states', () => {
    expect(isAlternative({ genericName: 'باراسيتامول' }, panadol)).toBe(true);
    expect(
      isAlternative({ genericName: 'باراسيتامول', strength: '500 ملغ' }, { ...panadol, dosageForm: 'شراب' }),
    ).toBe(true);
  });

  it('never guesses without a generic name', () => {
    expect(isAlternative({ genericName: null }, { genericName: null })).toBe(false);
    expect(isAlternative({ genericName: '' }, { genericName: '' })).toBe(false);
    expect(isAlternative({ strength: '500 ملغ' }, panadol)).toBe(false);
  });
});

describe('round 38: months for the expiring report', () => {
  it('adds calendar months, keeping the last day of a shorter month', () => {
    expect(addMonthsISO('2026-10-30', 3)).toBe('2027-01-30');
    expect(addMonthsISO('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsISO('2027-12-15', 1)).toBe('2028-01-15');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-10-30', 0)).toBe('2026-10-30');
  });

  it('counts the days between two dates', () => {
    expect(daysBetweenISO('2026-10-30', '2027-01-30')).toBe(92);
    expect(daysBetweenISO('2026-10-30', '2026-10-30')).toBe(0);
    expect(daysBetweenISO('2026-10-30', '2026-10-25')).toBe(-5);
  });
});

describe('round 38: the shortage request', () => {
  const id = '0192a3b4-c5d6-7e8f-9a0b-000000000001';
  it('keeps its own id, a default of one, and no note', () => {
    expect(shortageRequestInput.parse({ id, variantId: null, name: ' سيروم ' })).toEqual({
      id,
      variantId: null,
      name: 'سيروم',
      qty: 1000,
      note: null,
    });
  });
  it('refuses a missing name or a wrong id', () => {
    expect(shortageRequestInput.safeParse({ id, variantId: null, name: '  ' }).success).toBe(false);
    expect(shortageRequestInput.safeParse({ id: 'x', variantId: null, name: 'دواء' }).success).toBe(false);
  });
  it('the setting «بيع المنتهي برمز المدير» is kept in the pharmacy settings', () => {
    expect(
      pharmacySettingsSchema.parse({ prescription: 'optional', allowExpiredWithCode: true }),
    ).toMatchObject({ allowExpiredWithCode: true });
  });
});
