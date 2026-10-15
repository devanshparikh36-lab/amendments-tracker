import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { DefinitionBox } from "@/components/DefinitionBox";
import { KIND_LABEL } from "@/lib/catalogue";
import { searchDefinitions, type DefinitionHit } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Search definitions" };

type Search = Promise<{ q?: string; reg?: string }>;

/* The five regulators, in the words a practitioner uses rather than the codes the database stores.
 *
 * "Income tax" and "GST" are how somebody thinks about where a definition lives; CBDT and CBIC are how
 * the collector files it. The code is kept as the value in the URL because it is short, stable and
 * already what every other part of the site keys on. */
const REGULATORS: { code: string; label: string }[] = [
  { code: "CBDT", label: "Income tax" },
  { code: "CBIC", label: "GST & customs" },
  { code: "MCA", label: "Companies" },
  { code: "SEBI", label: "Securities" },
  { code: "RBI", label: "FEMA & banking" },
];

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
  /* A text fragment, so the browser lands the reader on the words rather than on the section holding them.
   *
   * Section 2 of the Income-tax Act is the definitions section: one provision carrying a hundred-odd
   * clauses. Linking to ?p=2 and stopping there dropped the reader at the top of all of them to find
   * "capital asset" by eye, which is most of the work they came here to avoid. The PDF branch already
   * solved its half with ?pq=; this brings the HTML branch level.
   *
   * `#:~:text=` is done by the browser: it scrolls to the first match and highlights it in the browser's
   * own colours, with no JavaScript of ours involved. That last part is the point. The version before this
   * was a client component that found the text and painted it, and it cost three separate attempts to get
   * wrong -- marks wiped by hydration, a two-pass render that only worked under hot reload, and finally a
   * production hydration failure (React #418) that appeared purely from mounting a null-rendering client
   * component beside the provision body. A browser feature has none of that surface.
   *
   * Unsupported browsers ignore the fragment and land on the section, which is exactly the old behaviour,
   * so the floor here is what shipped before and the ceiling is the definition itself. */
  const fragment = h.number ? `#:~:text=${encodeURIComponent(term)}` : "";
  const sectionHref = h.number
    ? `/browse/${h.slug}/text?p=${encodeURIComponent(h.number)}${fragment}`
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
        {/* A plain anchor, not <Link>: a text fragment is only honoured on a document load, and a
            client-side navigation would silently drop it. See the note on sectionHref. */}
        <a href={sectionHref} className="serif text-[15px] font-semibold text-[var(--link)] hover:underline">
          {h.short_code}
          {h.number ? ` — ${h.number}` : h.pdf_page ? ` — page ${h.pdf_page}` : ""}
        </a>
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
        <a href={sectionHref} className="text-[var(--link)] hover:underline">
          {h.number
            ? `Read it in the ${KIND_LABEL[h.kind]?.toLowerCase() === "act" ? "section" : "provision"}`
            : "Open at this page"}
        </a>
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
  const { q, reg } = await searchParams;
  const term = (q ?? "").trim();
  const active = REGULATORS.some((r) => r.code === reg) ? (reg as string) : null;
  const hits = term ? await searchDefinitions(term, 80, active) : [];
  const activeLabel = REGULATORS.find((r) => r.code === active)?.label ?? null;

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
        {/* Keeps the chosen regulator when a suggestion is picked. Without it, selecting a term from the
            list silently widened the search back to everywhere. */}
        {active && <input type="hidden" name="reg" value={active} />}
        <label htmlFor="q" className="sr-only">
          Word to find the definition of
        </label>
        {/* The masthead's SearchBox is deliberately not used here -- it offers sections, instruments and
            notifications, which answer "find me this" rather than "what does this word mean". This box
            suggests the one thing the page is about: terms that are actually defined somewhere. */}
        <DefinitionBox defaultValue={term} />
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

      {/* Every regulator, every time, and no counts.
          
          The first version showed only the regulators that had a hit, with counts beside them -- which
          meant the control vanished on any term defined in one place, which is most of them. A filter
          that is sometimes there is worse than one that always is: a reader cannot learn where it lives.
          
          Counts went with it. They were only possible while filtering happened after the fetch, and that
          was the thing making the filter unable to find anything the unfiltered ranking had cut. Asking
          the database for counts as well would mean running the same regex scan a second time, on the
          heaviest query the site has, to decorate a label. */}
      {term && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/definitions?q=${encodeURIComponent(term)}`}
            aria-current={!active ? "true" : undefined}
            className={`chip ${!active ? "chip-on" : ""}`}
          >
            Everywhere
          </Link>
          {REGULATORS.map((r) => (
            <Link
              key={r.code}
              href={`/definitions?q=${encodeURIComponent(term)}&reg=${r.code}`}
              aria-current={active === r.code ? "true" : undefined}
              className={`chip ${active === r.code ? "chip-on" : ""}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      )}

      {term && (
        <section className="panel px-5 py-1">
          <p className="py-2 text-[12px] text-[var(--ink-3)]">
            {hits.length === 0
              ? `No instrument we hold defines “${term}”${activeLabel ? ` in ${activeLabel}` : ""}.`
              : `${hits.length} ${hits.length === 1 ? "definition" : "definitions"} of “${term}”${
                  activeLabel ? ` in ${activeLabel}` : ""
                }.`}
          </p>
          {hits.length > 0 && (
            <ul className="mb-2">
              {hits.map((h) => (
                <Hit key={`${h.slug}-${h.number}-${h.pdf_page ?? ""}`} h={h} term={term} />
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
