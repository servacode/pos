/**
 * Barcodes drawn by the dashboard for labels (03 › الملابس: ملصقات وصور): EAN-13 for 13-digit codes
 * with a valid check digit (the store's own codes, prefix 29, and makers' codes), Code 128 (set B)
 * for anything else a scanner reads. Each returns the bars as a string of modules, 1 dark and
 * 0 light, quiet zones included, so any renderer can draw them.
 */

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
/** Which of L and G encodes each of the left six digits, by the first digit */
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

export function ean13Valid(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function ean13Modules(code: string): string {
  if (!ean13Valid(code)) throw new RangeError('not an EAN-13 code');
  const parity = PARITY[Number(code[0])]!;
  let out = '0'.repeat(9) + '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    out += parity[i - 1] === 'L' ? L[d] : G[d];
  }
  out += '01010';
  for (let i = 7; i <= 12; i++) out += R[Number(code[i])];
  return out + '101' + '0'.repeat(9);
}

/** Code 128 patterns by value, as bar/space widths (each value is 11 modules; stop is 13) */
const C128 = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];
const START_B = 104;
const STOP = 106;

const widthsToModules = (widths: string) =>
  [...widths].map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(w))).join('');

/** Code 128 set B: printable ASCII 32–126 */
export function code128Modules(text: string): string {
  if (text.length === 0 || text.length > 48 || [...text].some((c) => c < ' ' || c > '~')) {
    throw new RangeError('Code 128 B takes 1–48 printable ASCII characters');
  }
  const values = [START_B, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  const all = [...values, check, STOP];
  return '0'.repeat(10) + all.map((v) => widthsToModules(C128[v]!)).join('') + '0'.repeat(10);
}

/** The bars of a code: EAN-13 when it is one, Code 128 otherwise. */
export function barcodeModules(code: string): { modules: string; kind: 'ean13' | 'code128' } {
  return ean13Valid(code)
    ? { modules: ean13Modules(code), kind: 'ean13' }
    : { modules: code128Modules(code), kind: 'code128' };
}
