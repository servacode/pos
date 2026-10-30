/**
 * Device document numbers (08 › الترقيم، 15 › الترقيم دون اتصال): SERIES-BRANCH-DEVICE-SEQUENCE,
 * e.g. INV-001-002-0000154. Three digits for the branch, three for the device (000 is the server's),
 * seven for the sequence. The device holds a counter per series and takes the next number in the
 * same local transaction that saves the document, so a power cut never leaves a gap.
 */

export const MAX_SEQUENCE = 9_999_999;
const CODE = /^\d{3}$/;
const NUMBER = /^([A-Z]{2,3})-(\d{3})-(\d{3})-(\d{7})$/;

export interface DocNumber {
  series: string;
  branchCode: string;
  deviceCode: string;
  sequence: number;
}

export class NumberingError extends Error {
  override readonly name = 'NumberingError';
}

export function formatDocNumber({ series, branchCode, deviceCode, sequence }: DocNumber): string {
  if (!/^[A-Z]{2,3}$/.test(series)) throw new NumberingError(`bad series ${series}`);
  if (!CODE.test(branchCode)) throw new NumberingError(`branch code must be 3 digits: ${branchCode}`);
  if (!CODE.test(deviceCode) || deviceCode === '000') {
    throw new NumberingError(`device code must be 3 digits other than 000: ${deviceCode}`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new NumberingError(`sequence out of range: ${sequence}`);
  }
  return `${series}-${branchCode}-${deviceCode}-${String(sequence).padStart(7, '0')}`;
}

export function parseDocNumber(number: string): DocNumber | null {
  const match = NUMBER.exec(number);
  if (!match) return null;
  const sequence = Number(match[4]);
  if (sequence < 1) return null;
  return { series: match[1]!, branchCode: match[2]!, deviceCode: match[3]!, sequence };
}
