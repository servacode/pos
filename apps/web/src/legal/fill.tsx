import { Fragment, type ReactNode } from 'react';
import { BLANK_LABELS, LEGAL, PLACEHOLDER, type LegalKey } from './config';

const MARKER = /\{(\w+)\}/g;

/** A blank the owner has not filled yet: loud on purpose, so it cannot slip into a launch. */
export function Blank({ name }: { name: LegalKey }) {
  const label = BLANK_LABELS[name] ?? name;
  return (
    <mark
      data-blank={name}
      title={`يُملأ في apps/web/src/legal/config.ts: ${label}`}
      className="rounded-small bg-warning-soft px-1 font-semibold text-warning-ink"
    >
      {PLACEHOLDER}
    </mark>
  );
}

/** A value from the config, set in its own direction when it is Latin or digits (a number, an email). */
function Value({ name }: { name: LegalKey }) {
  const value = LEGAL[name];
  if (value === null || value === '') return <Blank name={name} />;
  if (typeof value === 'number') return <bdi className="num">{value}</bdi>;
  if (typeof value === 'string' && /^[\x20-\x7E]+$/.test(value)) return <bdi dir="ltr">{value}</bdi>;
  return <>{String(value)}</>;
}

/** The `{name}` markers in a text read from the config. */
export function fill(text: string): ReactNode {
  const parts = text.split(MARKER);
  return parts.map((part, index) =>
    index % 2 === 1 ? <Value key={index} name={part as LegalKey} /> : <Fragment key={index}>{part}</Fragment>,
  );
}

/** Every marker a text uses, for the test that checks they all exist in the config. */
export function markersOf(text: string): string[] {
  return [...text.matchAll(MARKER)].map((match) => match[1] ?? '');
}
