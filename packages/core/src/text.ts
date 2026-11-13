const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Number punctuation typed on Arabic keyboards or copied from formatted amounts, mapped to Latin. */
const NUMBER_PUNCTUATION: Readonly<Record<string, string>> = {
  '٫': '.', // U+066B ARABIC DECIMAL SEPARATOR
  '٬': ',', // U+066C ARABIC THOUSANDS SEPARATOR (kept as a separator so parsers can still check grouping)
  '\u2212': '-', // U+2212 MINUS SIGN, the sign formatMoney writes
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
const BIDI_CONTROLS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

/**
 * Removes invisible direction controls, e.g. before parsing pasted text, exporting to CSV or printing plain
 * text on a receipt printer whose code page has no such characters.
 */
export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROLS, '');
}

/** Letter forms folded together for search: hamza seats to bare alef/waw/yaa, taa marbuta to haa, alef maqsura to yaa. */
const SEARCH_FOLD: Readonly<Record<string, string>> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ؤ: 'و',
  ئ: 'ي',
  ى: 'ي',
  ة: 'ه',
  ی: 'ي', // Persian yeh
  ک: 'ك', // Persian kaf
};

/** Harakat, shadda, sukun, superscript alef (U+064B–U+065F, U+0670) and tatweel (U+0640). */
const SEARCH_DROP = /[ً-ٰٟـ]/g;

/**
 * The one search form used by the cashier, the admin and the server, so a product typed «شوكولا»,
 * «شوكولاتة» or «شُوكولاته» is found the same everywhere: diacritics and tatweel removed, hamza seats,
 * taa marbuta and alef maqsura folded, digits Latin, Latin letters lower case, spaces collapsed.
 */
export function normalizeArabic(input: string): string {
  let out = '';
  for (const ch of stripBidiControls(toLatinDigits(input)).replace(SEARCH_DROP, '').toLowerCase()) {
    out += SEARCH_FOLD[ch] ?? ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The forms of a counted noun: «فاتورة واحدة», «فاتورتان», «فواتير» (3-10), «فاتورة» (11 and up). */
export interface CountForms {
  /** Exactly one, with its own «واحد/واحدة» */
  one: string;
  /** Exactly two (the dual) */
  two: string;
  /** From three to ten (and zero), the plural */
  few: string;
  /** Eleven and more: the singular, in the accusative («15 متغيراً») */
  many: string;
}

const countRules = new Intl.PluralRules('ar');

/**
 * A count with its noun in correct Arabic number agreement: one, two, 3-10 plural, 11 and up
 * singular accusative. The one helper every screen uses for «N أصناف», «حتى N مستخدماً»…; `shown` is
 * the number as the screen writes it (Latin or Arabic-Indic digits), the count itself by default, and
 * `oblique` writes the dual after a preposition («حتى فرعين»).
 */
export function countNoun(
  count: number,
  forms: CountForms,
  shown: string = String(count),
  oblique = false,
): string {
  switch (countRules.select(count)) {
    case 'one':
      return forms.one;
    case 'two':
      // After «حتى» or a preposition the dual ends in «ين»: «حتى فرعين»
      return oblique ? forms.two.replace(/ان(?= |$)/, 'ين') : forms.two;
    case 'zero':
    case 'few':
      return `${shown} ${forms.few}`;
    default:
      return `${shown} ${forms.many}`;
  }
}

/** The nouns the screens count. Add one here rather than writing a plural in a screen. */
export const COUNT_NOUNS = {
  invoice: { one: 'فاتورة واحدة', two: 'فاتورتان', few: 'فواتير', many: 'فاتورة' },
  variant: { one: 'متغيّر واحد', two: 'متغيّران', few: 'متغيّرات', many: 'متغيّراً' },
  user: { one: 'مستخدم واحد', two: 'مستخدمان', few: 'مستخدمين', many: 'مستخدماً' },
  device: { one: 'جهاز واحد', two: 'جهازان', few: 'أجهزة', many: 'جهازاً' },
  branch: { one: 'فرع واحد', two: 'فرعان', few: 'فروع', many: 'فرعاً' },
  item: { one: 'صنف واحد', two: 'صنفان', few: 'أصناف', many: 'صنفاً' },
  customer: { one: 'زبون واحد', two: 'زبونان', few: 'زبائن', many: 'زبوناً' },
  piece: { one: 'قطعة واحدة', two: 'قطعتان', few: 'قطع', many: 'قطعة' },
  batch: { one: 'دفعة واحدة', two: 'دفعتان', few: 'دفعات', many: 'دفعة' },
  row: { one: 'سطر واحد', two: 'سطران', few: 'أسطر', many: 'سطراً' },
} as const satisfies Record<string, CountForms>;
