import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchBox } from "@/components/SearchBox";
import { KIND_LABEL, unitPlural } from "@/lib/catalogue";
import { fileHref, pdfHref } from "@/lib/files";
import { fmtDate } from "@/lib/format";
import { pdfPageHref, provisionHref, resolveLookup } from "@/lib/lookup";
import { getInstrument, search, searchAllPages, logSearch } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

// "Look up" was the old header button's name and went with it; this page is where a search lands.
export const metadata = { title: "Search" };

// One box for everything. A query that names one obvious provision goes straight there;
// anything else lands on a short list of one-click answers.
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string; in?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  if (!q) redirect("/");
  // Searching from inside an Act answers about that Act. Without this the results were the whole library,
  // which is rarely what someone reading one instrument is asking.
  const within = (sp.in ?? "").trim() || null;
  const scope = within ? await getInstrument(within) : null;

  const lookup = await resolveLookup(q);
  if (lookup.jumpTo && sp.all !== "1" && !scope) redirect(lookup.jumpTo);

  // The text search is scoped in SQL -- a document knows which instruments it is tagged against, and the
  // page cannot reconstruct that from what it is sent. The page search is narrowed here instead, because it
  // already returns the instrument on every row; its limit is raised when scoped so that confining to one
  // Act does not leave only the handful that ranked highest across the whole library.
  const [text, wordPagesAll] = await Promise.all([search(q, 25, within), searchAllPages(q, scope ? 100 : 12)]);
  const wordPages = scope ? wordPagesAll.filter((p) => p.instrument_slug === scope.slug) : wordPagesAll;

  // resolveLookup only searches the pages of instruments the query *named*, so a phrase on its own reached
  // none of the 107 PDF-only instruments. These are the pages matched by words alone, merged in behind
  // them: a page found both ways is the same page, and the lookup's ordering is the better one because it
  // knows about heading hits.
  const lookupPages = scope ? lookup.pages.filter((p) => p.instrument_slug === scope.slug) : lookup.pages;
  const seenPages = new Set(lookupPages.map((p) => `${p.instrument_slug}#${p.page_no}`));
  const pages = [...lookupPages, ...wordPages.filter((p) => !seenPages.has(`${p.instrument_slug}#${p.page_no}`))];
  const instruments = scope ? [] : lookup.instruments;
  const numbered = scope ? lookup.provisions.filter((p) => p.instrument_slug === scope.slug) : lookup.provisions;

  const nothing =
    !numbered.length &&
    !pages.length &&
    !instruments.length &&
    !text.provisions.length &&
    !text.documents.length;

  // Recorded after the results are known, and not awaited: a reader gets their answer whether or not the
  // row was written. What a search found nothing for is the only measure of coverage on this site that
  // comes from its readers rather than from us -- every other one counts what we happen to hold.
  void logSearch({
    query: q,
    found: !nothing,
    scope: within,
    provisions: numbered.length + text.provisions.length,
    documents: text.documents.length,
    pages: pages.length,
    instruments: instruments.length,
  });

  // Where the block of PDF pages belongs depends on what was asked.
  //
  // A query carrying a provision number ("LODR 17") is answered by a page of the regulator's own file that
  // opens at that number, so it leads. A phrase ("input tax credit") is answered better by the parsed
  // consolidated text, which knows which section it is; a page hit only knows which page it is. Leading with
  // pages for a phrase put the loosest match on the page at the top and the exact one below the fold.
  const pdfPagesLead = lookup.parsed.number != null;
  const pdfPagesSection = pages.length > 0 && (
    <section className="panel">
      <div className="panel-head">
        <h2 className="eyebrow">In the regulator&rsquo;s own PDF</h2>
        <span className="meta ml-auto">each result opens that file at the page the match is on</span>
      </div>
      <ol className="feed px-4 py-1">
        {pages.map((p) => {
          const url = fileHref(p.pdf_storage_key, p.pdf_source_url);
          return (
            <li key={`${p.instrument_slug}-${p.page_no}`} className="py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={pdfPageHref(p.instrument_slug, p.page_no, q)} className="font-semibold hover:underline">
                  Page {p.page_no}
                </Link>
                <span className="text-[13.5px] text-[var(--ink-2)]">{p.instrument_title}</span>
                {url && (
                  <a
                    href={pdfHref(url, p.page_no)}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-[12px] text-[var(--ink-3)] hover:underline"
                  >
                    open the PDF here
                  </a>
                )}
              </div>
              <p
                className="snippet mt-0.5 line-clamp-2 text-[13px] text-[var(--ink-2)]"
                dangerouslySetInnerHTML={{ __html: p.snippet }}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <form action="/find" role="search" className="flex flex-wrap gap-2">
          <label htmlFor="find-q" className="sr-only">
            {scope ? `Search within ${scope.title}` : "Search"}
          </label>
          {scope && <input type="hidden" name="in" value={scope.slug} />}
          <SearchBox
            id="find-q"
            defaultValue={q}
            autoFocus
            className="field field-lg w-full"
            within={scope?.slug ?? null}
          />
          <button className="btn btn-primary px-5">Search</button>
        </form>
        {scope && (
          <p className="meta mt-2">
            Searching inside{" "}
            <Link href={`/browse/${scope.slug}`} className="font-medium text-[var(--ink-2)] hover:underline">
              {scope.title}
            </Link>
            .{" "}
            <Link href={`/find?q=${encodeURIComponent(q)}&all=1`} className="text-[var(--link)] hover:underline">
              Search everything instead
            </Link>
          </p>
        )}
        {!scope && sp.all === "1" && lookup.jumpTo && (
          <p className="meta mt-2">
            Showing every match for &ldquo;{q}&rdquo;.{" "}
            <Link href={lookup.jumpTo} className="text-[var(--link)] hover:underline">
              Go to the best match
            </Link>
          </p>
        )}
      </div>

      {pdfPagesLead && pdfPagesSection}

      {numbered.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">
              {lookup.parsed.number} in{" "}
              {numbered.length === 1 ? "one instrument" : `${numbered.length} instruments`}
            </h2>
          </div>
          <ol className="feed">
            {numbered.map((p) => (
              <li key={p.id}>
                <Link
                  href={provisionHref(p.instrument_slug, p.number)}
                  className="block px-4 py-2 hover:bg-[#faf9f6]"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold capitalize">
                      {labelFor(p.kind)} {p.number}
                    </span>
                    <span className="text-[13.5px] text-[var(--ink-2)]">{p.heading?.replace(/[.\-\s]+$/, "")}</span>
                    <span className="meta ml-auto">{p.instrument_title}</span>
                  </div>
                  {p.snippet && <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--ink-3)]">{p.snippet}</p>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {instruments.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">Regulations</h2>
          </div>
          <ul className="feed">
            {instruments.map((i) => (
              <li key={i.id}>
                <Link href={`/browse/${i.slug}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-[#faf9f6]">
                  <span className="min-w-0 flex-1 text-[13.5px]">{i.title}</span>
                  <span className="meta num whitespace-nowrap">
                    {KIND_LABEL[i.kind] ?? i.kind}
                    {i.pdf_only
                      ? ` · official PDF, ${(i.page_count || i.pdf_page_count || 0).toLocaleString("en-IN")} pages`
                      : i.provision_count > 0
                        ? ` · ${i.provision_count.toLocaleString("en-IN")} ${unitPlural(i.kind)}`
                        : " · no text yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {text.provisions.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">In the consolidated text</h2>
          </div>
          <ul className="feed px-4 py-1">
            {text.provisions.map((r) => (
              <li key={r.provision_id} className="py-2">
                <Link href={provisionHref(r.instrument_slug, r.number)} className="font-medium hover:underline">
                  {r.instrument_title} · {r.number}
                </Link>
                <p
                  className="snippet mt-0.5 text-[13px] text-[var(--ink-2)]"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!pdfPagesLead && pdfPagesSection}

      {/* One panel, full width. There used to be a second beside it searching attachment.extracted_text --
          dropped, because it searched a copy. Compaction moved that text onto the document row, so no
          attachment holds text its document lacks, and a query returned at most two documents the panel
          beside it had not already found while costing five to ten seconds of the wait. Searching inside
          the stored PDFs still works and is still how it is worded: the text below is what was read out of
          the PDF, and "open the PDF here" lands on the page that matched. */}
      {text.documents.length > 0 && (
        <section>
          <div className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">Notifications and circulars</h2>
            </div>
            <ul className="feed px-4 py-1">
              {text.documents.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/documents/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <div className="meta num">
                    {fmtDate(r.date_issued)} {r.number && <>· {r.number}</>}
                    {" · "}
                    <a
                      href={`/api/jump?doc=${r.id}&q=${encodeURIComponent(q)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--link)] hover:underline"
                    >
                      open the PDF here
                    </a>
                  </div>
                  <p
                    className="snippet mt-0.5 text-[13px] text-[var(--ink-2)]"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                </li>
              ))}
              {text.documents.length === 0 && <li className="py-3 text-[13px] text-[var(--ink-3)]">Nothing.</li>}
            </ul>
          </div>
        </section>
      )}

      {nothing && (
        <p className="panel border-dashed p-8 text-center text-[var(--ink-2)]">
          Nothing matches &ldquo;{q}&rdquo;. Try a section number on its own (<em>80C</em>), a regulation short name (
          <em>LODR</em>), or a phrase from the text.
        </p>
      )}
    </div>
  );
}

function labelFor(kind: string): string {
  if (kind === "rules") return "rule";
  if (kind === "regulations") return "regulation";
  if (kind === "master_direction" || kind === "master_circular") return "para";
  return "section";
}
