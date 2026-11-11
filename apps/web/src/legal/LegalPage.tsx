import { Link } from 'react-router';
import { Alert, Button, Logo, PrintIcon, TextLink, ThemeToggle } from '@serva/ui';
import { BLANK_LABELS, LEGAL, LEGAL_READY, remainingBlanks, type LegalKey } from './config';
import { fill } from './fill';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import type { LegalDocument } from './types';

const DOCUMENTS = { terms: TERMS, privacy: PRIVACY } as const;
const PATHS = { terms: '/terms', privacy: '/privacy' } as const;

/** /terms and /privacy: public, outside every app, readable on a phone and clean on paper. */
export function LegalPage({ document: key }: { document: keyof typeof DOCUMENTS }) {
  const doc = DOCUMENTS[key];
  const other = DOCUMENTS[key === 'terms' ? 'privacy' : 'terms'];
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <title>{`${doc.title} · Serva POS`}</title>
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-2 sm:px-6">
          <Link to="/" className="flex min-h-12 items-center rounded-control" aria-label="سيرفا">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 pt-8 pb-16 sm:px-6 print:pt-0">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold text-ink">{doc.title}</h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>
              الإصدار <bdi className="num font-semibold text-ink">{LEGAL.version}</bdi>
            </span>
            <span>
              آخر تحديث <bdi className="num font-semibold text-ink">{LEGAL.updatedAt}</bdi>
            </span>
          </p>
          <div className="print:hidden">
            <Button variant="secondary" size="sm" icon={<PrintIcon size={16} />} onClick={() => window.print()}>
              اطبع الصفحة
            </Button>
          </div>
        </div>

        {LEGAL_READY ? null : <DraftNotice />}

        <section
          aria-label="ملخص"
          className="rounded-card border border-line bg-brand-soft p-5 text-brand-ink shadow-e1"
        >
          <p className="mb-1 text-xs font-semibold">باختصار</p>
          <p className="text-[0.9375rem] leading-7">{fill(doc.summary)}</p>
        </section>

        <nav aria-label="المحتويات" className="rounded-card border border-line bg-surface p-5 print:hidden">
          <h2 className="mb-3 text-lg font-semibold">المحتويات</h2>
          <ol className="grid gap-x-8 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
            {doc.sections.map((section, index) => (
              <li key={section.id} className="flex gap-2">
                {doc.numbered ? <span className="num w-6 shrink-0 text-ink-subtle">{index + 1}.</span> : null}
                <a
                  href={`#${section.id}`}
                  className="min-h-8 rounded-small py-1 text-ink-muted hover:text-ink focus-visible:text-ink"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex flex-col gap-8">
          <Sections doc={doc} />
        </article>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-ink-muted print:hidden">
          <TextLink as={Link} to={PATHS[other.key]}>
            {other.title}
          </TextLink>
          <TextLink as={Link} to="/">
            الرئيسية
          </TextLink>
        </footer>
      </main>
    </div>
  );
}

function Sections({ doc }: { doc: LegalDocument }) {
  return doc.sections.map((section, index) => (
    <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-6">
      <h2 id={`${section.id}-title`} className="mb-2 flex gap-2 text-lg font-semibold text-ink">
        {doc.numbered ? <span className="num text-brand-ink">{index + 1}.</span> : null}
        {section.title}
      </h2>
      {section.text ? <p className="leading-8 text-ink-muted">{fill(section.text)}</p> : null}
      {section.table ? (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-xl border-collapse text-start text-sm">
            <thead>
              <tr className="bg-surface-muted/60 text-xs font-semibold text-ink-subtle">
                {section.table.head.map((cell) => (
                  <th key={cell} scope="col" className="px-3 py-2.5 text-start">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row[0]} className="border-t border-line align-top">
                  {row.map((cell, column) => (
                    <td
                      key={column}
                      className={column === 0 ? 'px-3 py-3 font-semibold text-ink' : 'px-3 py-3 text-ink-muted'}
                    >
                      {fill(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  ));
}

/** Until the lawyer has reviewed the texts and every blank is filled, the page says it is a draft. */
function DraftNotice() {
  const blanks = remainingBlanks();
  const named = blanks.map((key) => BLANK_LABELS[key as LegalKey] ?? key);
  return (
    <Alert tone="warning" title="مسودة قيد المراجعة القانونية">
      هذا النص مسودة، ولا يُعتمد قبل أن يراجعه محامٍ.
      {named.length > 0 ? ` بقيت ${named.length} خانات فارغة.` : ''}
    </Alert>
  );
}
