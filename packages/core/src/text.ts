const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Latin digits, leaving everything else as is. */
export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    const e = EXTENDED_ARABIC_INDIC.indexOf(ch);
    out += e >= 0 ? String(e) : ch;
  }
  return out;
}
