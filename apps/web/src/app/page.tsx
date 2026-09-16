import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import {
  COMPARE_HREF,
  KIND_LABEL,
  SUBJECTS,
  type Subject,
  shortTitle,
  subjectClass,
} from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { instrumentIndex, listDocuments, recentByRegulator, type InstrumentRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  { q: "80C", label: "80C" },
  { q: "regulation 17 LODR", label: "LODR 17" },
  { q: "section 16 CGST", label: "section 16 CGST" },
  { q: "ECB", label: "ECB Master Direction" },
];

// Something to read: parsed provisions, or the regulator's own PDF indexed page by page.
function hasText(i: InstrumentRow): boolean {
  return i.pdf_only ? i.page_count > 0 : i.provision_count > 0;
}

// The few instruments a subject actually opens with: the curated slugs that exist and have text,
// then — for SEBI — its most recently stated master circulars. Nothing else.
function curated(s: Subject, bySlug: Map<string, InstrumentRow>, all: InstrumentRow[]) {
  const picked: InstrumentRow[] = [];
  for (const slug of s.featured) {
    const inst = bySlug.get(slug);
    if (inst && hasText(inst) && !picked.some((p) => p.slug === inst.slug)) picked.push(inst);
    if (picked.length >= 6) break;
  }
  const extra = s.featuredPrefix
    ? all
        .filter((i) => i.slug.startsWith(s.featuredPrefix as string) && hasText(i))
        .sort(
          (a, b) =>
            (b.official_updated_as_on ?? "").localeCompare(a.official_updated_as_on ?? "") ||
            a.title.localeCompare(b.title),
        )
        .slice(0, s.featuredPrefixLimit ?? 5)
    : [];
  return { picked, extra };
}

type Search = Promise<{ subject?: string }>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const chosen = SUBJECTS.find((s) => s.key === sp.subject) ?? null;
  const shown = chosen ? [chosen] : SUBJECTS;

  const needsDocs = shown.filter((s) => s.recentDocuments);
  const [instruments, feed, docLists] = await Promise.all([
    instrumentIndex(),
    recentByRegulator(chosen ? 8 : 4),
    Promise.all(
      needsDocs.map((s) => listDocuments({ regulator: s.regulators[0], limit: s.recentDocuments ?? 5 })),
    ),
  ]);

  const bySlug = new Map(instruments.map((i) => [i.slug, i]));
  const docsFor = new Map(needsDocs.map((s, idx) => [s.key, docLists[idx]]));

  const blocks = shown.map((s) => ({
    subject: s,
    ...curated(s, bySlug, instruments),
    documents: docsFor.get(s.key) ?? [],
    recent: feed
      .filter((d) => s.regulators.includes(d.regulator_code))
      .sort((a, b) => (b.date_issued ?? "").localeCompare(a.date_issued ?? ""))
      .slice(0, chosen && !s.recentDocuments ? 8 : 0),
  }));

  return (
    <div className="mx-auto max-w-[76rem] space-y-12">
      {/* --- the one box that answers "where is 80C" ------------------------ */}
      <section>
        <h1 className="page-title">Look up any section, rule or regulation</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--ink-2)]">
          Every screen shows the regulator&rsquo;s own text, as the regulator publishes it, with a link to the official
          document it came from.
        </p>
        <form action="/find" role="search" className="mt-5 flex flex-wrap gap-2">
          <label htmlFor="home-q" className="sr-only">
            Search sections, regulations and notifications
          </label>
          <SearchBox
            id="home-q"
            autoFocus
            className="field field-lg w-full"
            placeholder="A section number, a regulation name, or any phrase"
          />
          <button className="btn btn-primary px-7 text-[15px]">Search</button>
        </form>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {EXAMPLES.map((e) => (
            <Link key={e.q} href={`/find?q=${encodeURIComponent(e.q)}`} className="chip">
              {e.label}
            </Link>
          ))}
        </div>
      </section>

      {/* --- pick a subject ------------------------------------------------- */}
      <nav aria-label="Subjects" className="no-print flex flex-wrap items-center gap-1.5">
        <Link href="/" className={`chip ${!chosen ? "chip-on" : ""}`}>
          All subjects
        </Link>
        {SUBJECTS.map((s) => (
          <Link key={s.key} href={`/?subject=${s.key}`} className={`chip ${chosen?.key === s.key ? "chip-on" : ""}`}>
            {s.name}
          </Link>
        ))}
      </nav>

      <div className={chosen ? "mx-auto max-w-3xl" : "grid gap-6 md:grid-cols-2 xl:grid-cols-3"}>
        {blocks.map((b) => (
          <section key={b.subject.key} className={`panel sub-rule ${subjectClass(b.subject.key)} flex flex-col`}>
            <div className="px-5 pt-4">
              <h2 className="serif text-[17px] font-semibold tracking-tight">
                <Link href={`/browse?subject=${b.subject.key}`} className="hover:underline">
                  {b.subject.name}
                </Link>
              </h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{b.subject.blurb}</p>
            </div>

            {b.subject.compare && (
              <div className="px-5 pt-4">
                <CompareCallout />
              </div>
            )}

            {b.subject.search && (
              <form action="/find" role="search" className="flex gap-2 px-5 pt-4">
                <label htmlFor={`q-${b.subject.key}`} className="sr-only">
                  Search {b.subject.name}
                </label>
                <SearchBox id={`q-${b.subject.key}`} placeholder={b.subject.search} />
                <button className="btn">Search</button>
              </form>
            )}

            <ul className="flex-1 px-5 py-4">
              {b.picked.map((i) => (
                <Entry key={i.slug} i={i} />
              ))}
              {b.picked.length === 0 && (
                <li className="py-2 text-[13px] text-[var(--ink-3)]">Text not loaded yet.</li>
              )}
            </ul>

            {b.extra.length > 0 && (
              <div className="px-5 pb-4">
                <h3 className="eyebrow border-t border-[var(--rule)] pt-3">
                  {b.subject.featuredPrefixHeading ?? "Also"}
                </h3>
                <ul className="pt-1.5">
                  {b.extra.map((i) => (
                    <Entry key={i.slug} i={i} hideKind />
                  ))}
                </ul>
              </div>
            )}

            {b.documents.length > 0 && (
              <div className="px-5 pb-4">
                <h3 className="eyebrow border-t border-[var(--rule)] pt-3">
                  Latest {b.subject.regulators[0]} circulars and notifications
                </h3>
                <ul className="pt-1.5">
                  {b.documents.map((d) => (
                    <li key={d.id} className="py-[5px] leading-6">
                      <Link href={`/documents/${d.id}`} className="text-[13.5px] hover:underline">
                        {d.title}
                      </Link>
                      <span className="num ml-2 whitespace-nowrap text-[12px] text-[var(--ink-4)]">
                        {fmtDate(d.date_issued)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {b.recent.length > 0 && (
              <div className="px-5 pb-4">
                <h3 className="eyebrow border-t border-[var(--rule)] pt-3">Recently notified</h3>
                <ul className="pt-1.5">
                  {b.recent.map((d) => (
                    <li key={d.id} className="flex items-baseline gap-2.5 py-[5px] leading-6">
                      <span className="feed-date w-[4.6rem] shrink-0">{fmtDate(d.date_issued) || "—"}</span>
                      <Link href={`/documents/${d.id}`} className="min-w-0 flex-1 text-[13.5px] hover:underline">
                        {d.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--rule)] px-5 py-2.5 text-[12.5px]">
              <Link
                href={`/browse?subject=${b.subject.key}`}
                className="text-[var(--ink-3)] hover:text-[var(--link)] hover:underline"
              >
                Everything in {b.subject.name} &rarr;
              </Link>
            </div>
          </section>
        ))}
      </div>

      {!chosen && (
        <section className="border-t border-[var(--rule)] pt-4 text-[13px]">
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[var(--ink-3)]">
            <Link href="/documents" className="hover:text-[var(--link)] hover:underline">
              Every notification and circular
            </Link>
            <Link href="/browse" className="hover:text-[var(--link)] hover:underline">
              Every tracked instrument
            </Link>
            <Link href="/status" className="hover:text-[var(--link)] hover:underline">
              Collection status
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

// The concordance, stated plainly at the top of income tax rather than buried in a row of footer links:
// matching a 1961 section to its 2025 counterpart is the main reason people open this subject.
function CompareCallout({ label = "Compare the Income-tax Act, 1961 with the Income-tax Act, 2025" }: { label?: string }) {
  return (
    <div className="compare-cta">
      <div className="min-w-[14rem] flex-1">
        <h2>{label}</h2>
        <p>Look up any section and read it beside its counterpart, on CBDT&rsquo;s own mapping.</p>
      </div>
      <Link href={COMPARE_HREF} className="btn btn-primary px-5 py-2 text-[14px]">
        Open the comparison
      </Link>
    </div>
  );
}

// One entry point: what it is called, and — quietly — the date the regulator states its text as.
function Entry({ i, hideKind }: { i: InstrumentRow; hideKind?: boolean }) {
  return (
    <li className="py-[7px] leading-6">
      <Link href={`/browse/${i.slug}`} className="group block">
        <span className="text-[14px] text-[var(--ink)] group-hover:underline">{shortTitle(i.title)}</span>
        <span className="ml-2 whitespace-nowrap text-[12px] text-[var(--ink-4)]">
          {hideKind ? "" : (KIND_LABEL[i.kind] ?? i.kind)}
          {i.official_updated_as_on ? `${hideKind ? "" : " · "}as on ${fmtDate(i.official_updated_as_on)}` : ""}
          {i.pdf_only ? " · official PDF" : ""}
        </span>
      </Link>
    </li>
  );
}
