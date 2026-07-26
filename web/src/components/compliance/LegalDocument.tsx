// Shared chrome for public legal / compliance documents.
// Used by /terms, /privacy, /community-guidelines, /support (ASR App Store P0).
// Mobile: collapsible TOC + 44px tap targets + safe-area scroll margins (iPhone/iPad).

import type { ReactNode } from 'react';

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

export interface LegalDocumentProps {
  title: string;
  /** Human-readable last-updated date, e.g. "July 26, 2026". */
  lastUpdated: string;
  sections: LegalSection[];
  /** When true (default), show a TOC (collapsible on small screens, sticky on lg+). */
  showToc?: boolean;
  /** Optional footer note below the sections. */
  footerNote?: ReactNode;
}

function TocLinks({ sections }: { sections: LegalSection[] }) {
  return (
    <ul className="space-y-1 border-l border-white/10 pl-3">
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex min-h-[44px] items-center text-sm text-zinc-400 transition-colors hover:text-[var(--brand-gold)] focus-visible:text-[var(--brand-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function LegalDocument({
  title,
  lastUpdated,
  sections,
  showToc = true,
  footerNote,
}: LegalDocumentProps) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      <div className={showToc ? 'lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10' : undefined}>
        {showToc && sections.length > 0 ? (
          <>
            {/* Mobile / tablet: collapsible TOC (always available under lg) */}
            <details className="group mb-6 rounded-xl border border-white/10 bg-white/[0.02] lg:hidden">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-zinc-100 marker:content-none [&::-webkit-details-marker]:hidden">
                <span>On this page</span>
                <span
                  className="text-zinc-500 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                >
                  ▾
                </span>
              </summary>
              <nav aria-label="On this page" className="border-t border-white/10 px-4 py-3">
                <TocLinks sections={sections} />
              </nav>
            </details>

            {/* Desktop sticky TOC */}
            <nav
              aria-label="On this page"
              className="mb-8 hidden lg:sticky lg:top-24 lg:mb-0 lg:block lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto"
            >
              <p className="mb-3 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                On this page
              </p>
              <TocLinks sections={sections} />
            </nav>
          </>
        ) : null}

        <article className="min-w-0">
          <header className="mb-8 border-b border-white/10 pb-6">
            <h1 className="text-balance text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 text-sm text-zinc-400">
              Last updated: <time dateTime={lastUpdated}>{lastUpdated}</time>
            </p>
          </header>

          <div className="space-y-10">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="scroll-mt-[calc(5rem+env(safe-area-inset-top,0px))]"
              >
                <h2
                  id={`${section.id}-heading`}
                  className="mb-3 text-xl font-semibold tracking-tight text-zinc-100"
                >
                  {section.title}
                </h2>
                <div className="space-y-3 text-base leading-relaxed text-zinc-300 sm:text-base [&_a]:inline-flex [&_a]:min-h-[44px] [&_a]:items-center [&_a]:text-[var(--brand-gold)] [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:mt-1.5 [&_ol]:ml-5 [&_ol]:list-decimal [&_strong]:font-semibold [&_strong]:text-zinc-100 [&_ul]:ml-5 [&_ul]:list-disc">
                  {section.content}
                </div>
              </section>
            ))}
          </div>

          {footerNote ? (
            <footer className="mt-12 border-t border-white/10 pt-6 text-xs leading-relaxed text-zinc-500">
              {footerNote}
            </footer>
          ) : null}
        </article>
      </div>
    </div>
  );
}
