import { describe, expect, it } from 'vitest';
import {
  controlledRegisterQuery,
  pharmacySettingsSchema,
  DEFAULT_PHARMACY_SETTINGS,
} from './contracts/pharmacy';
import { missingPrescription, pickBatch, prescriptionNeed } from './pharmacy';

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

describe('the pharmacy contracts', () => {
  it('accepts only the two prescription modes, and defaults to optional', () => {
    expect(pharmacySettingsSchema.safeParse({ prescription: 'required' }).success).toBe(true);
    expect(pharmacySettingsSchema.safeParse({ prescription: 'optional' }).success).toBe(true);
    expect(pharmacySettingsSchema.safeParse({ prescription: 'maybe' }).success).toBe(false);
    expect(DEFAULT_PHARMACY_SETTINGS).toEqual({ prescription: 'optional' });
  });

  it('takes a register window that does not run backwards', () => {
    expect(controlledRegisterQuery.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(controlledRegisterQuery.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(true);
    const backwards = controlledRegisterQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' });
    expect(backwards.success).toBe(false);
    expect(controlledRegisterQuery.safeParse({ from: 'x', to: '2026-10-01' }).success).toBe(false);
  });
});
