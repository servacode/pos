const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Number punctuation typed on Arabic keyboards or copied from formatted amounts, mapped to Latin. */
const NUMBER_PUNCTUATION: Readonly<Record<string, string>> = {
  '٫': '.', // U+066B ARABIC DECIMAL SEPARATOR
  '٬': ',', // U+066C ARABIC THOUSANDS SEPARATOR (kept as a separator so parsers can still check grouping)
  '−': '-', // U+2212 MINUS SIGN, the sign formatMoney writes
};

/**
 * Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Latin digits, the Arabic decimal and thousands
 * separators «٫» «٬» to "." and ",", and the minus sign «−» to "-". Everything else is left as is, so
 * toLatinDigits(an Arabic-digit amount) equals the Latin-digit amount.
 */
export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) {
      out += String(a);
      continue;
    }
    const e = EXTENDED_ARABIC_INDIC.indexOf(ch);
    if (e >= 0) {
      out += String(e);
      continue;
    }
    out += NUMBER_PUNCTUATION[ch] ?? ch;
  }
  return out;
}

/** LRM, RLM, ALM, the embeddings and overrides (U+202A–U+202E) and the isolates (U+2066–U+2069). */
const BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g;

/**
 * Removes invisible direction controls, e.g. before parsing pasted text, exporting to CSV or printing plain
 * text on a receipt printer whose code page has no such characters.
 */
export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROLS, '');
}
