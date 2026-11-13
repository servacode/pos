import { Fragment, type ReactNode } from 'react';
import { BLANK_LABELS, LEGAL, PLACEHOLDER, type LegalKey, type LegalValues } from './config';

const MARKER = /\{(\w+)\}/g;

/** A blank the owner has not filled yet: loud on purpose, so it cannot slip into a launch. */
export function Blank({ name }: { name: LegalKey }) {
  const label = BLANK_LABELS[name] ?? name;
  return (
    <mark
      data-blank={name}
      title={`يُملأ من لوحة المنصة › بيانات الشركة: ${label}`}
      className="rounded-small bg-warning-soft px-1 font-semibold text-warning-ink"
    >
      {PLACEHOLDER}
    </mark>
  );
}

/** A value, set in its own direction when it is Latin or digits (a number, an email). */
function Value({ name, values }: { name: LegalKey; values: LegalValues }) {
  const value = values[name];
  if (value === null || value === '') return <Blank name={name} />;
  if (typeof value === 'number') return <bdi className="num">{value}</bdi>;
  if (typeof value === 'string' && /^[ -~]+$/.test(value)) return <bdi dir="ltr">{value}</bdi>;
  return <>{String(value)}</>;
}

/**
 * Phrases that depend on an optional value: the commercial register and the phone are named only
 * when they are filled, so the sentence reads naturally without them; the owner is a blank like
 * the others.
 */
const CLAUSES = {
  ownerClause: (values: LegalValues) => (
    <>
      ، وصاحب المشروع <Value name="ownerName" values={values} />
    </>
  ),
  registerClause: (values: LegalValues) =>
    values.commercialRegister ? (
      <>
        ، المسجّلة في سوريا برقم <Value name="commercialRegister" values={values} />
      </>
    ) : null,
  phoneClause: (values: LegalValues) =>
    values.phone ? (
      <>
        ، الهاتف <Value name="phone" values={values} />
      </>
    ) : null,
} as const;

/** The names a text may use besides the keys of the values. */
export const CLAUSE_NAMES: readonly string[] = Object.keys(CLAUSES);

/** The `{name}` markers in a text read from the values. */
export function fill(text: string, values: LegalValues = LEGAL): ReactNode {
  const parts = text.split(MARKER);
  return parts.map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    if (part in CLAUSES)
      return <Fragment key={index}>{CLAUSES[part as keyof typeof CLAUSES](values)}</Fragment>;
    return <Value key={index} name={part as LegalKey} values={values} />;
  });
}

/** Every marker a text uses, for the test that checks they all exist in the config. */
export function markersOf(text: string): string[] {
  return [...text.matchAll(MARKER)].map((match) => match[1] ?? '');
}
