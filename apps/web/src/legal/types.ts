export interface LegalTable {
  head: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface LegalSection {
  id: string;
  title: string;
  /** Paragraph text; `{name}` markers read from LEGAL (config.ts) */
  text?: string;
  table?: LegalTable;
}

export interface LegalDocument {
  key: 'terms' | 'privacy';
  title: string;
  /** The two-line plain-language summary above the full text */
  summary: string;
  /** Numbered clauses (terms) or plain sections (privacy) */
  numbered: boolean;
  sections: readonly LegalSection[];
}
