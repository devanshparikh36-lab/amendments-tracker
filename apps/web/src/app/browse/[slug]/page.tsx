import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/Badge";
import {
  COMPARE_HREF,
  COMPARE_SLUGS,
  KIND_LABEL,
  REGULATOR_LABEL,
  SUBJECT_BY_REGULATOR,
  subjectClass,
  unitFor,
} from "@/lib/catalogue";
import { fileHref, pdfHref } from "@/lib/files";
import { DOC_TYPE_LABEL, fmtDate, slugifyNumber } from "@/lib/format";
import {
  getInstrument,
  instrumentAmendments,
  instrumentChapters,
  instrumentOpeningProvisions,
  instrumentOverview,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ p?: string; asOn?: string; view?: string; pq?: string; page?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const inst = await getInstrument(slug);
  return { title: inst ? inst.title : "Instrument" };
}

function n(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("en-IN");
}

// The landing page for one Act, Rules, Regulations or Master Direction: what it is, who issued it,
// what state the text is in, what has changed it, and the ways into the text itself.
export default async function InstrumentPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;

  // Links and bookmarks made before the reading view moved keep working.
  const legacy = new URLSearchParams();
  for (const k of ["p", "asOn", "view", "pq", "page"] as const) if (sp[k]) legacy.set(k, sp[k] as string);
  if ([...legacy].length) redirect(`/browse/${slug}/text?${legacy.toString()}`);

  const inst = await getInstrument(slug);
  if (!inst) notFound();

  const [overview, amendments, chapters, opening] = await Promise.all([
    instrumentOverview(inst.id),
    instrumentAmendments(inst.id, 8),
    inst.pdf_only ? Promise.resolve([]) : instrumentChapters(inst.id),
    inst.pdf_only ? Promise.resolve([]) : instrumentOpeningProvisions(inst.id, 10),
  ]);

  const unit = unitFor(inst.kind);
  const kindLabel = KIND_LABEL[inst.kind] ?? inst.kind;
  const subject = SUBJECT_BY_REGULATOR[inst.regulator_code];
  const pdfUrl = fileHref(inst.pdf_storage_key, inst.pdf_source_url);
  const pageCount = inst.page_count || inst.pdf_page_count || 0;
  const hasText = inst.pdf_only ? pageCount > 0 : overview.provisions > 0;
  const readHref = `/browse/${slug}/text`;
  // The 1961 to 2025 concordance belongs to income tax, so it is offered on those two Acts and nowhere else.
  const compareLabel = COMPARE_SLUGS[slug];

  return (
    <div className="space-y-5">
      <header className={`panel sub-rule ${subject ? subjectClass(subject.key) : ""} px-6 py-5`}>
        <p className="crumbs no-print">
          <Link href="/">Home</Link> / <Link href="/browse">Acts &amp; Rules</Link>
          {subject && (
            <>
              {" "}
              / <Link href={`/browse?subject=${subject.key}`}>{subject.name}</Link>
            </>
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h1 className="page-title">{inst.title}</h1>
            <p className="meta mt-1">
              {kindLabel} · issued by {REGULATOR_LABEL[inst.regulator_code] ?? inst.regulator_code} · cited here as{" "}
              <span className="font-medium text-[var(--ink-2)]">{inst.short_code}</span>
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            {hasText && (
              <Link href={readHref} className="btn btn-primary">
                {inst.pdf_only ? "Open the official PDF" : `Read the ${unit}s`}
              </Link>
            )}
            {inst.official_url && (
              <a href={inst.official_url} target="_blank" rel="noreferrer" className="btn">
                {inst.regulator_code}&rsquo;s page
              </a>
            )}
            {pdfUrl && (
              <a href={pdfHref(pdfUrl, null)} target="_blank" rel="noreferrer" className="btn">
                Stored PDF{pageCount ? ` (${pageCount} pp)` : ""}
              </a>
            )}
          </div>
        </div>

        {inst.pdf_only ? (
          <p className="provenance provenance-pdf mt-4">
            {inst.regulator_code} publishes this instrument only as a consolidated PDF. That file is what this site
            serves; we do not split it into {unit}s the official document does not have. The{" "}
            {n(pageCount)} indexed pages are searchable as a finding aid only.
          </p>
        ) : overview.official_html > 0 ? (
          <p className="provenance mt-4">
            {n(overview.official_html)} of {n(overview.provisions)} {unit}s are stored with{" "}
            {REGULATOR_LABEL[inst.regulator_code] ?? inst.regulator_code}&rsquo;s own published HTML and are shown in
            the department&rsquo;s own formatting — its rate tables, indented clauses and provisos as printed.
            {overview.machine > 0 && (
              <>
                {" "}
                {n(overview.machine)} {unit}s currently show a machine-consolidated version, marked as such wherever
                they appear.
              </>
            )}
          </p>
        ) : overview.machine > 0 ? (
          <p className="provenance provenance-machine mt-4">
            {n(overview.machine)} of {n(overview.provisions)} {unit}s currently show text our merge engine produced by
            applying amending documents to the last official version. No person has reviewed those; the official
            document is linked on every {unit}.
          </p>
        ) : hasText ? (
          <p className="provenance mt-4">
            Text reproduced verbatim from {REGULATOR_LABEL[inst.regulator_code] ?? inst.regulator_code}&rsquo;s own
            publication, with the official document linked on every {unit}.
          </p>
        ) : (
          <p className="provenance provenance-pdf mt-4">
            The text of this instrument has not been loaded yet. Documents recorded against it are listed below.
          </p>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0 space-y-5">
          {/* --- the details of this instrument --------------------------- */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">Details of this {kindLabel.toLowerCase()}</h2>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Full title</dt>
                <dd>{inst.title}</dd>

                <dt>Type</dt>
                <dd>{kindLabel}</dd>

                <dt>Issuing authority</dt>
                <dd>{REGULATOR_LABEL[inst.regulator_code] ?? inst.regulator_code}</dd>

                <dt>Subject</dt>
                <dd>
                  {subject ? (
                    <Link href={`/browse?subject=${subject.key}`} className="text-[var(--link)] hover:underline">
                      {subject.name}
                    </Link>
                  ) : (
                    inst.regulator_code
                  )}
                </dd>

                <dt>Text as on</dt>
                <dd className="num">
                  {inst.official_updated_as_on ? (
                    fmtDate(inst.official_updated_as_on)
                  ) : (
                    <span className="text-[var(--ink-4)]">not stated by the regulator</span>
                  )}
                </dd>

                {overview.earliest_in_force && (
                  <>
                    <dt>Earliest version in force</dt>
                    <dd className="num">{fmtDate(overview.earliest_in_force)}</dd>
                  </>
                )}

                <dt>{inst.pdf_only ? "Pages" : `${unit[0].toUpperCase()}${unit.slice(1)}s`}</dt>
                <dd className="num">
                  {inst.pdf_only
                    ? `${n(pageCount)} pages of the official PDF, indexed`
                    : `${n(overview.provisions)}${overview.chapters ? ` in ${n(overview.chapters)} chapters` : ""}`}
                </dd>

                <dt>Amendments recorded</dt>
                <dd className="num">
                  {overview.effects > 0 ? (
                    <>
                      {n(overview.effects)} changes to individual {unit}s, from {n(overview.amending_documents)}{" "}
                      documents
                      {overview.effects_differ > 0 && (
                        <>
                          {" · "}
                          <Link href="/status" className="text-[var(--link)] hover:underline">
                            {n(overview.effects_differ)} flagged for review
                          </Link>
                        </>
                      )}
                    </>
                  ) : overview.amending_documents > 0 ? (
                    `${n(overview.amending_documents)} amending documents recorded`
                  ) : (
                    <span className="text-[var(--ink-4)]">none recorded yet</span>
                  )}
                </dd>

                <dt>Documents tagged</dt>
                <dd className="num">
                  {overview.documents > 0 ? (
                    <Link href={`/documents?instrument=${slug}`} className="text-[var(--link)] hover:underline">
                      {n(overview.documents)} notifications, circulars and gazette copies
                    </Link>
                  ) : (
                    <span className="text-[var(--ink-4)]">none yet</span>
                  )}
                  {overview.first_document && (
                    <span className="text-[var(--ink-4)]"> · from {fmtDate(overview.first_document)}</span>
                  )}
                </dd>

                <dt>Official source</dt>
                <dd className="space-y-0.5">
                  {inst.official_url ? (
                    <a
                      href={inst.official_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-[var(--link)] hover:underline"
                    >
                      {inst.official_url}
                    </a>
                  ) : (
                    <span className="text-[var(--ink-4)]">no official page recorded</span>
                  )}
                  {pdfUrl && (
                    <a
                      href={pdfHref(pdfUrl, null)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[var(--link)] hover:underline"
                    >
                      Stored copy of the official PDF{pageCount ? ` — ${n(pageCount)} pages` : ""}
                    </a>
                  )}
                  {inst.pdf_source_url && inst.pdf_source_url !== inst.official_url && (
                    <a
                      href={inst.pdf_source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-[var(--link)] hover:underline"
                    >
                      {inst.pdf_source_url}
                    </a>
                  )}
                </dd>
              </dl>
            </div>
          </section>

          {/* --- latest amendments affecting this instrument -------------- */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">Latest amendments affecting this {kindLabel.toLowerCase()}</h2>
              {overview.latest_amendment && <span className="meta num ml-auto">last {fmtDate(overview.latest_amendment)}</span>}
            </div>
            {amendments.length > 0 ? (
              <ul className="feed px-4 py-1">
                {amendments.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="feed-date w-[4.6rem] shrink-0">{fmtDate(a.date_issued) || "no date"}</span>
                      <Link href={`/documents/${a.id}`} className="min-w-0 flex-1 text-[13.5px] hover:underline">
                        {a.title}
                      </Link>
                      <Badge kind={a.relation} />
                    </div>
                    <p className="meta mt-0.5 pl-[5.1rem]">
                      {DOC_TYPE_LABEL[a.doc_type] ?? a.doc_type.replace(/_/g, " ")}
                      {a.number ? ` · ${a.number}` : ""}
                      {a.provisions ? (
                        <>
                          {" "}
                          · {unit}s{" "}
                          <span className="font-medium text-[var(--ink-2)]">
                            {a.provisions.length > 90 ? `${a.provisions.slice(0, 90)}…` : a.provisions}
                          </span>
                        </>
                      ) : (
                        ""
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-body text-[13.5px] text-[var(--ink-3)]">
                No document collected so far is recorded as amending this instrument.
                {overview.documents > 0 && (
                  <>
                    {" "}
                    {n(overview.documents)} document{overview.documents === 1 ? " refers" : "s refer"} to it —{" "}
                    <Link href={`/documents?instrument=${slug}`} className="text-[var(--link)] hover:underline">
                      see them all
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
            {overview.amending_documents > amendments.length && (
              <div className="border-t border-[var(--rule)] px-4 py-2 text-[12.5px]">
                <Link href={`/documents?instrument=${slug}`} className="text-[var(--link)] hover:underline">
                  All {n(overview.amending_documents)} amending documents &rarr;
                </Link>
              </div>
            )}
          </section>

          {/* --- how this instrument is arranged -------------------------- */}
          {chapters.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="eyebrow">Arrangement of {unit}s</h2>
                <span className="meta ml-auto">{n(chapters.length)} chapters</span>
              </div>
              <ul className="panel-body columns-1 gap-x-10 text-[13.5px] leading-7 sm:columns-2">
                {chapters.map((c) => (
                  <li key={c.id} className="break-inside-avoid">
                    <Link
                      href={`${readHref}?view=full#${slugifyNumber(c.number)}`}
                      className="block truncate hover:underline"
                      title={c.heading ?? c.number}
                    >
                      <span className="num font-medium">{c.number}</span>{" "}
                      <span className="text-[var(--ink-2)]">{c.heading}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* --- ways into the text --------------------------------------- */}
        <aside className="no-print space-y-4">
          {hasText && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="eyebrow">{inst.pdf_only ? "Find it in the PDF" : `Go to a ${unit}`}</h2>
              </div>
              <div className="panel-body space-y-3">
                {inst.pdf_only ? (
                  <form action={readHref} className="space-y-2">
                    <label htmlFor="pq" className="block text-[12.5px] text-[var(--ink-2)]">
                      Search the text read out of the official pages, then open the PDF at that page.
                    </label>
                    <div className="flex gap-2">
                      <input id="pq" name="pq" className="field min-w-0 flex-1" placeholder="regulation 17" />
                      <button className="btn btn-primary">Search</button>
                    </div>
                  </form>
                ) : (
                  <form action={readHref} className="space-y-2">
                    <label htmlFor="p" className="block text-[12.5px] text-[var(--ink-2)]">
                      Type the {unit} number and open it with the official text alongside.
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="p"
                        name="p"
                        className="field min-w-0 flex-1"
                        placeholder={opening[0] ? opening[0].number : "80C"}
                      />
                      <button className="btn btn-primary">Open</button>
                    </div>
                  </form>
                )}
                <div className="flex flex-wrap gap-2 border-t border-[var(--rule)] pt-3">
                  <Link href={readHref} className="btn">
                    {inst.pdf_only ? "Open the PDF" : "Contents"}
                  </Link>
                  {!inst.pdf_only && (
                    <Link href={`${readHref}?view=full`} className="btn">
                      Full text
                    </Link>
                  )}
                  <Link href={`/documents?instrument=${slug}`} className="btn">
                    Documents
                  </Link>
                </div>
              </div>
            </section>
          )}

          {opening.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="eyebrow">Opening {unit}s</h2>
              </div>
              <ul className="px-4 py-2 text-[13.5px] leading-7">
                {opening.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`${readHref}?p=${encodeURIComponent(o.number)}`}
                      className="block truncate hover:underline"
                      title={o.heading ? `${o.number} — ${o.heading}` : o.number}
                    >
                      <span className="num font-medium">{o.number}</span>{" "}
                      <span className="text-[var(--ink-2)]">{o.heading?.replace(/[.\-\s]+$/, "")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="border-t border-[var(--rule)] px-4 py-2 text-[12.5px]">
                <Link href={readHref} className="text-[var(--link)] hover:underline">
                  Every {unit} &rarr;
                </Link>
              </div>
            </section>
          )}

          {subject && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="eyebrow">Elsewhere in {subject.name}</h2>
              </div>
              <div className="panel-body space-y-1.5 text-[13px]">
                <p className="text-[var(--ink-3)]">{subject.blurb}</p>
                {compareLabel && (
                  <Link href={COMPARE_HREF} className="block text-[var(--link)] hover:underline">
                    {compareLabel}
                  </Link>
                )}
                <Link href={`/browse?subject=${subject.key}`} className="block text-[var(--link)] hover:underline">
                  All {subject.name} instruments
                </Link>
                <Link
                  href={`/documents?regulator=${subject.regulators[0]}`}
                  className="block text-[var(--link)] hover:underline"
                >
                  What&rsquo;s new in {subject.name}
                </Link>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
