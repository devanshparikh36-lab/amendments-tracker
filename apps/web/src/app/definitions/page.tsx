import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { KIND_LABEL } from "@/lib/catalogue";
import { searchDefinitions, type DefinitionHit } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Search definitions" };

type Search = Promise<{ q?: string }>;

const EXAMPLES = ["capital asset", "associate company", "advance tax", "dividend", "turnover"];

// The defined term is quoted in the text; show that quotation as the eye would find it on the page.
function Snippet({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text.trim()}</>;
  return (
    <>
      {text.slice(0, i).trim()}{" "}
      <mark className="rounded bg-[var(--amend-bg)] px-0.5 font-medium">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

function Hit({ h, term }: { h: DefinitionHit; term: string }) {
  // A hit from a PDF-served instrument has no provision number -- those rows are deleted at seed time and
  // the page is all there is. It still gets a destination: the reading view opened at that page, with the
  // term carried through so the in-PDF search box arrives already filled in.
  const sectionHref = h.number
    ? `/browse/${h.slug}/text?p=${encodeURIComponent(h.number)}`
    : h.pdf_page
      ? `/browse/${h.slug}/text?page=${h.pdf_page}&pq=${encodeURIComponent(term)}`
      : `/browse/${h.slug}`;
  // The regulator's own file, opened at the page the definition sits on. Only offered when the definition
  // was actually located: a link to page 1 of a 900-page Act would be worse than no link.
  //
  // #page=N is the whole of what a browser's built-in PDF viewer honours. #search= is Adobe-only and is
  // silently ignored by Chrome and Firefox, so it is not used and not promised. Landing on the right page
  // with the sentence quoted and highlighted above the link is what actually gets a reader to the words.
  const pdfHref =
    h.pdf_storage_key && h.pdf_page ? `/api/files/${h.pdf_storage_key}#page=${h.pdf_page}` : null;
  return (
    <li className="border-b border-[var(--rule)] py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link href={sectionHref} className="serif text-[15px] font-semibold text-[var(--link)] hover:underline">
          {h.short_code}
          {h.number ? ` — ${h.number}` : h.pdf_page ? ` — page ${h.pdf_page}` : ""}
        </Link>
        {h.heading && <span className="text-[13px] text-[var(--ink-2)]">{h.heading.replace(/[.\-\s]+$/, "")}</span>}
        <span className="meta">{KIND_LABEL[h.kind] ?? h.kind}</span>
        {h.in_definitions_section && (
          <span className="rounded bg-[var(--amend-bg)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--ink-2)]">
            definitions section
          </span>
        )}
        {h.from_pdf && (
          <span className="meta" title="Read out of the regulator's own PDF, which is a finding aid rather than the official rendering">
            from the official PDF
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-1)]">
        …<Snippet text={h.snippet} term={term} />…
      </p>
      <p className="mt-1 text-[12px]">
        <Link href={sectionHref} className="text-[var(--link)] hover:underline">
          {h.number
            ? `Read the ${KIND_LABEL[h.kind]?.toLowerCase() === "act" ? "section" : "provision"}`
            : "Open at this page"}
        </Link>
        {pdfHref && (
          <>
            {" · "}
            <a href={pdfHref} target="_blank" rel="noreferrer" className="text-[var(--link)] hover:underline">
              Official PDF, page {h.pdf_page}
            </a>
          </>
        )}
      </p>
    </li>
  );
}

export default async function DefinitionsPage({ searchParams }: { searchParams: Search }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const hits = term ? await searchDefinitions(term) : [];

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumbs trail={[{ label: "Definitions" }]} />
        <h1 className="page-title mt-1">Search definitions</h1>
        <p className="mt-1 max-w-[62ch] text-[13px] text-[var(--ink-2)]">
          Where a word is <em>defined</em> — not merely mentioned. Every Act, Rule and Regulation whose text we
          hold is searched for the drafting that introduces a defined term, with the dedicated definitions
          sections listed first.
        </p>
      </div>

      <form action="/definitions" role="search" className="flex max-w-xl items-center gap-1.5">
        <label htmlFor="q" className="sr-only">
          Word to find the definition of
        </label>
        {/* No suggestion list: this box takes a word to be defined, and offering section numbers and
            notifications for it would answer a question nobody asked here. */}
        <input
          id="q"
          name="q"
          defaultValue={term}
          className="field min-w-0 flex-1"
          placeholder="capital asset"
          autoComplete="off"
        />
        <button className="btn btn-primary">Find</button>
      </form>

      {!term && (
        <p className="text-[13px] text-[var(--ink-3)]">
          Try{" "}
          {EXAMPLES.map((e, i) => (
            <span key={e}>
              {i > 0 && " · "}
              <Link href={`/definitions?q=${encodeURIComponent(e)}`} className="text-[var(--link)] hover:underline">
                {e}
              </Link>
            </span>
          ))}
        </p>
      )}

      {term && (
        <section className="panel px-5 py-1">
          <p className="py-2 text-[12px] text-[var(--ink-3)]">
            {hits.length === 0
              ? `No instrument we hold defines “${term}”.`
              : `${hits.length} ${hits.length === 1 ? "definition" : "definitions"} of “${term}”.`}
          </p>
          {hits.length > 0 && (
            <ul className="mb-2">
              {hits.map((h) => (
                <Hit key={`${h.slug}-${h.number}`} h={h} term={term} />
              ))}
            </ul>
          )}
          {hits.length === 0 && (
            <p className="pb-3 text-[13px] text-[var(--ink-2)]">
              A term is only found here when the text quotes it and then says <em>means</em>, <em>includes</em>,
              or similar. A word used throughout an Act but never formally defined will not appear — try{" "}
              <Link href={`/search?q=${encodeURIComponent(term)}`} className="text-[var(--link)] hover:underline">
                the full-text search
              </Link>{" "}
              instead.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
