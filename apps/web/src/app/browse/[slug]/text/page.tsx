import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { ProvisionBody, Provenance } from "@/components/LegalText";
import { OfficialNumber } from "@/components/OfficialNumber";
import { SectionFilter } from "@/components/SectionFilter";
import { KIND_LABEL, unitFor } from "@/lib/catalogue";
import { fileHref, pdfHref } from "@/lib/files";
import { fmtDate, slugifyNumber } from "@/lib/format";
import { parseQuery } from "@/lib/lookup";
import {
  getInstrument,
  getProvision,
  listProvisionIndex,
  listProvisions,
  lastAmendment,
  provisionDocuments,
  searchInstrumentPages,
  type InstrumentRow,
  type PageHit,
  type ProvisionRow,
} from "@/lib/queries";
import { officialSource, type OfficialSource } from "@/lib/source";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

type Params = Promise<{ slug: string }>;
type Search = Promise<{ p?: string; asOn?: string; view?: string; pq?: string; page?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const inst = await getInstrument(slug);
  return { title: inst ? inst.title : "Text" };
}

// The reading view: the contents of one instrument on the left, the regulator's text on the right.
export default async function InstrumentTextPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;
  const inst = await getInstrument(slug);
  if (!inst) notFound();
  if (inst.pdf_only) return <PdfReader inst={inst} slug={slug} sp={sp} />;

  const unit = unitFor(inst.kind);
  const suffix = sp.asOn ? `&asOn=${sp.asOn}` : "";
  const fullText = sp.view === "full" && !sp.p;

  const [index, selected, fullRows] = await Promise.all([
    listProvisionIndex(inst.id),
    sp.p ? getProvision(inst.id, sp.p, sp.asOn) : Promise.resolve(null),
    fullText ? listProvisions(inst.id, sp.asOn) : Promise.resolve([]),
  ]);
  const selectedDocs = selected ? await provisionDocuments(selected.id) : [];
  const source = officialSource(inst, selected);
  const sections = index.filter((i) => i.level !== "chapter");
  // Neighbours of the section being read, in the instrument's own order, so it can be read straight through
  // without going back to the contents list between every section. Chapters are excluded above, so "next"
  // is the next readable section rather than a chapter heading.
  const atIdx = selected ? sections.findIndex((s) => s.number === selected.number) : -1;
  const prevSection = atIdx > 0 ? sections[atIdx - 1] : null;
  const nextSection = atIdx >= 0 && atIdx < sections.length - 1 ? sections[atIdx + 1] : null;
  // The sidebar ships to the browser, so send only the fields it renders, trim the headings, and send a window
  // rather than the whole Act. The full contents used to go as props, which wrote all 935 sections into the
  // HTML and serialised them again for hydration -- the list paid for twice, 600 KB to read one section. The
  // rest arrives from /api/sections once the page is up, so the first paint carries the provision that was
  // asked for instead of the table of contents.
  const NAV_WINDOW = 60;
  const at = selected ? index.findIndex((i) => i.number === selected.number) : -1;
  const from = at >= 0 ? Math.max(0, at - Math.floor(NAV_WINDOW / 3)) : 0;
  const navItems = index.slice(from, from + NAV_WINDOW).map((i) => ({
    id: i.id,
    number: i.number,
    level: i.level,
    machine: i.machine,
    differs: i.differs,
    heading: i.heading && i.heading.length > 80 ? `${i.heading.slice(0, 80)}…` : i.heading,
  }));

  return (
    <div className="space-y-3">
      <div className="no-print">
        <p className="crumbs">
          <Link href="/">Home</Link> / <Link href="/browse">Acts &amp; Rules</Link> /{" "}
          <Link href={`/browse/${slug}`}>{inst.short_code}</Link> / text
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="serif text-[19px] font-semibold tracking-tight">
            <Link href={`/browse/${slug}`} className="hover:underline">
              {inst.title}
            </Link>
          </h1>
          <span className="meta">
            {KIND_LABEL[inst.kind] ?? inst.kind} · {sections.length.toLocaleString("en-IN")} {unit}s
            {inst.official_updated_as_on && <> · text as on {fmtDate(inst.official_updated_as_on)}</>}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/browse/${slug}`} className="btn">
            &larr; About this {KIND_LABEL[inst.kind]?.toLowerCase() ?? "instrument"}
          </Link>
          <Link
            href={`/browse/${slug}/text${fullText ? "" : "?view=full"}${
              sp.asOn ? `${fullText ? "?" : "&"}asOn=${sp.asOn}` : ""
            }`}
            className="btn"
          >
            {fullText ? "Contents" : "Read full text"}
          </Link>
          {!sp.p && source && (
            <a href={source.href} target="_blank" rel="noreferrer" className="btn">
              {source.label}
            </a>
          )}
          <form className="ml-auto flex items-center gap-2">
            {sp.p && <input type="hidden" name="p" value={sp.p} />}
            {fullText && <input type="hidden" name="view" value="full" />}
            <label htmlFor="asOn" className="text-[12px] text-[var(--ink-3)]">
              Text as on
            </label>
            <input id="asOn" type="date" name="asOn" defaultValue={sp.asOn ?? ""} className="field py-1 text-[12.5px]" />
            <button className="btn">Apply</button>
            {sp.asOn && (
              <Link
                href={`/browse/${slug}/text${sp.p ? `?p=${encodeURIComponent(sp.p)}` : ""}`}
                className="text-[12px] text-[var(--ink-3)] hover:underline"
              >
                today
              </Link>
            )}
          </form>
        </div>
      </div>

      {/* On a phone this collapses to one column, so the order matters: the provision you asked for comes
          first and the contents list follows it. Sticky full-height is a desktop idea -- applied on a narrow
          screen it puts a full viewport of table-of-contents above the text, and the reader has to scroll
          past the whole Act to reach the section they clicked. */}
      <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="panel no-print order-2 max-h-[60vh] overflow-y-auto lg:order-1 lg:sticky lg:top-3 lg:max-h-none lg:h-[calc(100vh-5.5rem)] lg:overflow-hidden">
          <SectionFilter items={navItems} total={sections.length} slug={slug} selected={sp.p} suffix={suffix} unit={unit} />
        </aside>

        <div className="print-full order-1 min-w-0 space-y-4 lg:order-2">
          {selected ? (
            <ProvisionView
              inst={inst}
              p={selected}
              slug={slug}
              unit={unit}
              source={source}
              docs={selectedDocs}
              asOn={sp.asOn}
              prev={prevSection}
              next={nextSection}
              suffix={suffix}
            />
          ) : fullText ? (
            <article className="space-y-3">
              <p className="provenance no-print">
                <strong>{inst.regulator_code}&rsquo;s own text</strong>, {sections.length.toLocaleString("en-IN")}{" "}
                {unit}s in the order the regulator prints them
                {inst.official_updated_as_on ? `, as on ${fmtDate(inst.official_updated_as_on)}` : ""}.
              </p>
              {fullRows.map((p) => (
                <section key={p.id} id={slugifyNumber(p.number)} className="panel px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-[var(--rule)] pb-1.5">
                    <Link
                      href={`/browse/${slug}/text?p=${encodeURIComponent(p.number)}`}
                      className="serif text-[15.5px] font-semibold hover:underline"
                    >
                      {p.level === "chapter" ? p.heading : `${unit} ${p.number}`}
                    </Link>
                    {p.level !== "chapter" && p.heading && (
                      <span className="serif text-[15px] text-[var(--ink-2)]">{p.heading.replace(/[.\-\s]+$/, "")}</span>
                    )}
                    {p.source_kind === "machine_merged" && <Badge kind="machine_merged" />}
                  </div>
                  <ProvisionBody p={p} />
                </section>
              ))}
              {fullRows.length === 0 && <NotSeeded />}
            </article>
          ) : index.length === 0 ? (
            <NotSeeded />
          ) : (
            <Contents index={index} slug={slug} suffix={suffix} unit={unit} source={source} />
          )}
        </div>
      </div>
    </div>
  );
}

function NotSeeded() {
  return (
    <p className="panel border-dashed p-8 text-center text-[var(--ink-2)]">
      The official text for this instrument has not been loaded yet. Notifications and circulars tagged to it are
      listed on its{" "}
      <Link href="/documents" className="text-[var(--link)] underline">
        documents page
      </Link>
      .
    </p>
  );
}

type Neighbour = { number: string; heading: string | null } | null;

function SectionStep({ slug, suffix, prev, next, unit }: { slug: string; suffix: string; prev: Neighbour; next: Neighbour; unit: string }) {
  if (!prev && !next) return null;
  const href = (n: NonNullable<Neighbour>) => `/browse/${slug}/text?p=${encodeURIComponent(n.number)}${suffix}`;
  const label = (n: NonNullable<Neighbour>) => (n.heading ? `${n.number} — ${n.heading.replace(/[.\-\s]+$/, "")}` : n.number);
  return (
    <nav className="no-print flex items-center justify-between gap-3 border-t border-[var(--rule)] px-5 py-2.5 text-[12px]">
      {prev ? (
        <Link href={href(prev)} className="min-w-0 truncate text-[var(--link)] hover:underline" title={label(prev)}>
          &larr; {unit} {label(prev)}
        </Link>
      ) : (
        <span className="text-[var(--ink-4)]">Start of the {unit === "section" ? "Act" : "instrument"}</span>
      )}
      {next ? (
        <Link href={href(next)} className="min-w-0 truncate text-right text-[var(--link)] hover:underline" title={label(next)}>
          {unit} {label(next)} &rarr;
        </Link>
      ) : (
        <span className="text-[var(--ink-4)]">End</span>
      )}
    </nav>
  );
}

function ProvisionView({
  inst,
  p,
  slug,
  unit,
  source,
  docs,
  asOn,
  prev,
  next,
  suffix,
}: {
  inst: InstrumentRow;
  p: ProvisionRow;
  slug: string;
  unit: string;
  source: OfficialSource;
  docs: Awaited<ReturnType<typeof provisionDocuments>>;
  asOn?: string;
  prev: Neighbour;
  next: Neighbour;
  suffix: string;
}) {
  const showEmbed = source?.kind === "pdf";
  const last = lastAmendment(docs);
  return (
    <div className={showEmbed ? "grid gap-4 xl:grid-cols-2" : ""}>
      <article className="panel">
        <header className="border-b border-[var(--rule)] px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="serif text-[18px] font-semibold capitalize">
              {unit} {p.number}
            </h2>
            {p.heading && (
              <span className="serif text-[16px] text-[var(--ink-2)]">{p.heading.replace(/[.\-\s]+$/, "")}</span>
            )}
          </div>
          <div className="meta mt-1 flex flex-wrap items-center gap-2">
            <Link href={`/browse/${slug}`} className="hover:underline">
              {inst.title}
            </Link>
            {p.source_kind && <Badge kind={p.source_kind} />}
            {p.differs > 0 && <Badge kind="differs_from_official" />}
            {p.effective_from && <span>w.e.f. {fmtDate(p.effective_from)}</span>}
            {asOn && <span>as on {fmtDate(asOn)}</span>}
          </div>
          <div className="no-print mt-3 flex flex-wrap items-center gap-2">
            {source ? (
              <a href={source.href} target="_blank" rel="noreferrer" className="btn btn-primary">
                {source.label}
              </a>
            ) : (
              <span className="text-[12px] text-[var(--ink-4)]">Official file not linked yet.</span>
            )}
            {p.source_url && source?.kind === "pdf" && (
              <a href={p.source_url} target="_blank" rel="noreferrer" className="btn">
                Source page
              </a>
            )}
            <Link href={`/browse/${slug}/${slugifyNumber(p.number)}/history`} className="btn">
              Amendment history{p.effect_count ? ` (${p.effect_count})` : ""}
            </Link>
          </div>
        </header>
        <SectionStep slug={slug} suffix={suffix} prev={prev} next={next} unit={unit} />
        {last && (
          <div className="border-b border-[var(--rule)] bg-[var(--amend-bg)] px-5 py-2.5 text-[13px]">
            {/* Three lines rather than one sentence: label, then what the notification is, then how to cite
                and open it. Run together they read as a single run of blue text and neither the title nor
                the number can be picked out at a glance. */}
            <p className="eyebrow">Last amended by</p>
            <p className="mt-1">
              <Link
                href={`/documents/${last.id}`}
                className="font-medium text-[var(--link)] hover:underline"
              >
                {last.title}
              </Link>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              {/* The number opens the notification as the regulator issued it; the title above opens our
                  page about it. Practitioners cite the number, so the number reaches the source document. */}
              <OfficialNumber doc={last} number={last.number} />
              {last.date_issued && <span className="num text-[var(--ink-3)]">dated {fmtDate(last.date_issued)}</span>}
              {last.source_url && (
                <a
                  href={last.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--link)] hover:underline"
                >
                  regulator&rsquo;s page
                </a>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-3)]">
              The text above is the regulator&rsquo;s consolidation
              {inst.official_updated_as_on ? ` as on ${fmtDate(inst.official_updated_as_on)}` : ""}. Read it with the
              amendments listed below.
            </p>
          </div>
        )}
        <div className="px-5 py-4">
          <div className="no-print mb-3">
            <Provenance p={p} regulator={inst.regulator_code} />
          </div>
          <ProvisionBody p={p} />
          {p.footnote && (
            <p className="mt-3 border-t border-[var(--rule)] pt-2 text-[12px] leading-relaxed text-[var(--ink-3)]">
              {p.footnote}
            </p>
          )}
        </div>
        {docs.length > 0 && (
          <section className="border-t border-[var(--rule)] px-5 py-3">
            <h3 className="eyebrow mb-1.5">Documents affecting this {unit}</h3>
            {/* Title, then citation, then status -- each on its own line. Titles here run long enough to
                wrap, and with the number inline behind a dot separator it landed wherever the wrap left it,
                reading as part of the date rather than as the citation. */}
            <ul className="feed text-[13.5px]">
              {docs.map((d) => (
                <li key={d.id} className="py-2.5">
                  <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                    {d.title}
                  </Link>
                  {d.number && (
                    <div className="mt-1">
                      <OfficialNumber doc={d} number={d.number} />
                    </div>
                  )}
                  <div className="meta mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="num">{fmtDate(d.date_issued)}</span>
                    {d.change_type && <Badge kind={d.change_type} />}
                    {d.verification_status && d.verification_status !== "unchecked" && (
                      <Badge kind={d.verification_status} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Repeated after the text: a long section would otherwise need scrolling back up to move on. */}
        <SectionStep slug={slug} suffix={suffix} prev={prev} next={next} unit={unit} />
      </article>

      {/* An embedded PDF needs real height to be readable, but a full viewport of it on a phone buries the
          text it sits beside. Shorter on small screens, sticky and full-height from xl up where it is a
          genuine second column. */}
      {showEmbed && source?.embed && (
        <aside className="panel no-print h-[70vh] overflow-hidden xl:sticky xl:top-3 xl:h-[calc(100vh-5.5rem)]">
          <div className="flex items-center justify-between border-b border-[var(--rule)] px-3 py-1.5 text-[12px] text-[var(--ink-3)]">
            <span>Official PDF{source.page ? `, page ${source.page}` : ""}</span>
            <a href={source.href} target="_blank" rel="noreferrer" className="text-[var(--link)] hover:underline">
              open in new tab
            </a>
          </div>
          <iframe src={source.embed} title="Official PDF" className="h-[calc(100%-2rem)] w-full" />
        </aside>
      )}
    </div>
  );
}

function Contents({
  index,
  slug,
  suffix,
  unit,
  source,
}: {
  index: Awaited<ReturnType<typeof listProvisionIndex>>;
  slug: string;
  suffix: string;
  unit: string;
  source: OfficialSource;
}) {
  const groups: { title: string | null; items: typeof index }[] = [];
  for (const row of index) {
    if (row.level === "chapter") groups.push({ title: row.heading || row.number, items: [] });
    else {
      if (!groups.length) groups.push({ title: null, items: [] });
      groups[groups.length - 1].items.push(row);
    }
  }

  return (
    <div className="space-y-3">
      <div className="panel panel-body">
        <p className="text-[13.5px] text-[var(--ink-2)]">
          Pick a {unit} below, or type its number in the filter box on the left and press Enter. Every {unit} opens
          with the regulator&rsquo;s own text and a link to the official document.
        </p>
        {source && (
          <a href={source.href} target="_blank" rel="noreferrer" className="btn mt-2">
            {source.label}
          </a>
        )}
      </div>

      {groups.map((g, gi) => (
        <section key={gi} className="panel px-5 py-4">
          {g.title && <h2 className="eyebrow mb-2.5">{g.title}</h2>}
          <ul className="columns-1 gap-x-10 text-[13.5px] leading-7 sm:columns-2 xl:columns-3">
            {g.items.map((i) => (
              <li key={i.id} className="break-inside-avoid">
                <Link
                  href={`/browse/${slug}/text?p=${encodeURIComponent(i.number)}${suffix}`}
                  className="block truncate hover:underline"
                  title={i.heading ? `${i.number} — ${i.heading}` : i.number}
                >
                  <span className="num font-medium">{i.number}</span>
                  {i.heading && <span className="text-[var(--ink-2)]"> {i.heading.replace(/[.\-\s]+$/, "")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instruments the regulator publishes only as a consolidated PDF. We serve that file and search the
// text read out of its pages; we never present that extracted text as the official rendering.

async function PdfReader({
  inst,
  slug,
  sp,
}: {
  inst: InstrumentRow;
  slug: string;
  sp: { pq?: string; page?: string };
}) {
  const pdfUrl = fileHref(inst.pdf_storage_key, inst.pdf_source_url);
  const pq = (sp.pq ?? "").trim();
  const pageCount = inst.page_count || inst.pdf_page_count || 0;
  const asked = Number.parseInt(sp.page ?? "", 10);
  const page = Number.isFinite(asked) && asked >= 1 ? (pageCount ? Math.min(asked, pageCount) : asked) : null;

  const hits = pq ? await searchInstrumentPages(inst.id, pq, { number: parseQuery(pq).number, limit: 25 }) : [];

  return (
    <div className="space-y-3">
      <div className="no-print">
        <p className="crumbs">
          <Link href="/">Home</Link> / <Link href="/browse">Acts &amp; Rules</Link> /{" "}
          <Link href={`/browse/${slug}`}>{inst.short_code}</Link> / the official PDF
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="serif text-[19px] font-semibold tracking-tight">
            <Link href={`/browse/${slug}`} className="hover:underline">
              {inst.title}
            </Link>
          </h1>
          <span className="meta">
            {KIND_LABEL[inst.kind] ?? inst.kind}
            {pageCount > 0 && <> · {pageCount} pages</>}
            {inst.official_updated_as_on && <> · text as on {fmtDate(inst.official_updated_as_on)}</>}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href={`/browse/${slug}`} className="btn">
            &larr; About this document
          </Link>
          {pdfUrl ? (
            <a href={pdfHref(pdfUrl, page)} target="_blank" rel="noreferrer" className="btn btn-primary">
              Open the official PDF{page ? ` at page ${page}` : ""}
            </a>
          ) : (
            <span className="text-[12px] text-[var(--ink-4)]">The official file is not stored yet.</span>
          )}
          {inst.official_url && (
            <a href={inst.official_url} target="_blank" rel="noreferrer" className="btn">
              {inst.regulator_code}&rsquo;s page for this document
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="no-print min-w-0 space-y-3">
          <p className="provenance provenance-pdf">
            {inst.regulator_code} publishes this instrument as one consolidated PDF, not as separate {unitFor(inst.kind)}s.
            What opens here <strong>is</strong> that file, exactly as issued
            {inst.official_updated_as_on ? ` (${fmtDate(inst.official_updated_as_on)})` : ""}. The search below runs over
            text read out of those pages — a finding aid only. Read the provision in the PDF itself.
          </p>

          <section className="panel panel-body">
            <form className="space-y-2">
              <label htmlFor="pq" className="eyebrow block">
                Search inside this PDF
              </label>
              <div className="flex gap-2">
                <input
                  id="pq"
                  name="pq"
                  defaultValue={pq}
                  placeholder="regulation 17, related party transaction"
                  className="field min-w-0 flex-1"
                />
                <button className="btn btn-primary">Search</button>
              </div>
            </form>
            <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--rule)] pt-3">
              {pq && <input type="hidden" name="pq" value={pq} />}
              <label htmlFor="page" className="text-[12px] text-[var(--ink-3)]">
                Go to page
                <input
                  id="page"
                  name="page"
                  type="number"
                  min={1}
                  max={pageCount || undefined}
                  defaultValue={page ?? ""}
                  className="field ml-2 w-20 py-1"
                />
              </label>
              <button className="btn">Go</button>
              {pageCount > 0 && <span className="pb-1 text-[12px] text-[var(--ink-4)]">of {pageCount}</span>}
            </form>
          </section>

          {pq && (
            <section>
              <h2 className="eyebrow mb-2">
                {hits.length === 0 ? "No page matches" : `${hits.length} page${hits.length === 1 ? "" : "s"} match “${pq}”`}
              </h2>
              <ol className="space-y-2">
                {hits.map((h) => (
                  <li
                    key={h.page_no}
                    className={`panel p-3 ${h.page_no === page ? "border-[var(--ink)]" : ""}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <Link
                        href={`/browse/${slug}/text?page=${h.page_no}&pq=${encodeURIComponent(pq)}`}
                        className="text-[13.5px] font-semibold text-[var(--link)] hover:underline"
                      >
                        Page {h.page_no}
                      </Link>
                      {h.heading_hit && <span className="text-[11.5px] text-[var(--ink-3)]">heading on this page</span>}
                      {pdfUrl && (
                        <a
                          href={pdfHref(pdfUrl, h.page_no)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto text-[11.5px] text-[var(--ink-3)] hover:underline"
                        >
                          open PDF here
                        </a>
                      )}
                    </div>
                    <PageSnippet hit={h} />
                  </li>
                ))}
                {hits.length === 0 && (
                  <li className="panel border-dashed p-4 text-[13.5px] text-[var(--ink-2)]">
                    Nothing on any page of this file matches that. Try a phrase from the text, or the regulation number
                    on its own.
                  </li>
                )}
              </ol>
            </section>
          )}
        </div>

        {pdfUrl ? (
          // For a PDF-only instrument the viewer is the content, so it keeps real height on a phone too --
          // just not a full viewport, which would hide the search results it exists to answer.
          <aside className="panel no-print h-[75vh] overflow-hidden lg:sticky lg:top-3 lg:h-[calc(100vh-5.5rem)]">
            <div className="flex items-center justify-between border-b border-[var(--rule)] px-3 py-1.5 text-[12px] text-[var(--ink-3)]">
              <span>
                Official PDF as published by {inst.regulator_code}
                {page ? ` · page ${page}` : ""}
              </span>
              <a href={pdfHref(pdfUrl, page)} target="_blank" rel="noreferrer" className="text-[var(--link)] hover:underline">
                open in new tab
              </a>
            </div>
            {/* Keyed on the page so a new result remounts the viewer: a bare #page change would not move it. */}
            <iframe
              key={page ?? 0}
              src={pdfHref(pdfUrl, page, true)}
              title={`${inst.title} — official PDF`}
              className="h-[calc(100%-2rem)] w-full"
            />
          </aside>
        ) : (
          <aside className="panel border-dashed p-8 text-center text-[13.5px] text-[var(--ink-2)]">
            The official file has not been stored yet.{" "}
            {inst.official_url && (
              <a href={inst.official_url} target="_blank" rel="noreferrer" className="text-[var(--link)] underline">
                Open it on {inst.regulator_code}&rsquo;s site
              </a>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ts_headline marks matches with <b>; the number-only branch returns escaped plain text. Both are
// produced by our own SQL, never by the source document.
function PageSnippet({ hit }: { hit: PageHit }) {
  return (
    <p
      className="snippet mt-1 text-[13px] leading-relaxed text-[var(--ink-2)]"
      dangerouslySetInnerHTML={{ __html: hit.snippet }}
    />
  );
}
