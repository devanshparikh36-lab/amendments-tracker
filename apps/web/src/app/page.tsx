import Link from "next/link";
import { KIND_LABEL, SUBJECTS, shortTitle, subjectClass, unitPlural } from "@/lib/catalogue";
import { DOC_TYPE_LABEL, fmtDate } from "@/lib/format";
import {
  documentCountsByRegulator,
  instrumentIndex,
  recentByRegulator,
  type FeedItem,
  type InstrumentRow,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  { q: "80C", label: "80C" },
  { q: "regulation 17 LODR", label: "regulation 17 LODR" },
  { q: "rule 8 incorporation", label: "rule 8 incorporation" },
  { q: "section 16 CGST", label: "section 16 CGST" },
  { q: "ECB", label: "ECB Master Direction" },
];

// Acts first, then the Rules made under them, then Regulations and the regulator's consolidated directions.
const KIND_ORDER = ["act", "rules", "regulations", "master_direction", "master_circular", "scheme", "other"];

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

// Something to read: parsed provisions, or the regulator's own PDF indexed page by page.
function hasText(i: InstrumentRow): boolean {
  return i.pdf_only ? i.page_count > 0 : i.provision_count > 0;
}

type Search = Promise<{ subject?: string }>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const chosen = SUBJECTS.find((s) => s.key === sp.subject) ?? null;
  const [instruments, counts, feed] = await Promise.all([
    instrumentIndex(),
    documentCountsByRegulator(),
    recentByRegulator(6),
  ]);

  const bySlug = new Map(instruments.map((i) => [i.slug, i]));
  const byReg = new Map(counts.map((d) => [d.regulator_code, d]));

  // One block per subject: its own recent documents, its own counts, its own instruments.
  const subjects = SUBJECTS.map((s) => {
    const mine = instruments.filter((i) => s.regulators.includes(i.regulator_code));
    const seeded = mine.filter(hasText);
    const featured: InstrumentRow[] = [];
    for (const slug of s.featured) {
      const inst = bySlug.get(slug);
      if (inst && hasText(inst)) featured.push(inst);
    }
    for (const inst of seeded) {
      if (featured.length >= 7) break;
      if (!featured.some((f) => f.slug === inst.slug)) featured.push(inst);
    }
    const items = feed
      .filter((d) => s.regulators.includes(d.regulator_code))
      .sort((a, b) => (b.date_issued ?? "").localeCompare(a.date_issued ?? ""))
      .slice(0, 6);
    const add = (k: "documents" | "last30" | "last90" | "effects") =>
      s.regulators.reduce((t, r) => t + (byReg.get(r)?.[k] ?? 0), 0);
    return {
      subject: s,
      featured,
      items,
      instruments: seeded.length,
      provisions: mine.reduce((t, i) => t + i.provision_count, 0),
      documents: add("documents"),
      last30: add("last30"),
      last90: add("last90"),
      effects: add("effects"),
      latest: s.regulators.map((r) => byReg.get(r)?.latest).filter(Boolean).sort().pop() ?? null,
    };
  });

  const totals = {
    instruments: instruments.filter(hasText).length,
    provisions: instruments.reduce((t, i) => t + i.provision_count, 0),
    documents: counts.reduce((t, d) => t + d.documents, 0),
    last30: counts.reduce((t, d) => t + d.last30, 0),
  };

  // Everything the chosen subject covers, grouped the way a reader asks for it: the Act first, then its
  // Rules, then Regulations and the regulator's consolidated directions.
  const chosenItems = chosen
    ? instruments
        .filter((i) => chosen.regulators.includes(i.regulator_code))
        .sort(
          (a, b) =>
            KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
            Number(hasText(b)) - Number(hasText(a)) ||
            b.provision_count - a.provision_count ||
            a.title.localeCompare(b.title),
        )
    : [];
  const chosenGroups = KIND_ORDER.map((kind) => ({
    kind,
    items: chosenItems.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);
  const chosenSummary = chosen ? subjects.find((s) => s.subject.key === chosen.key) : null;

  return (
    <div className="space-y-10">
      {/* --- pick a subject: the first thing on the page --------------------- */}
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

      {chosen && chosenSummary && (
        <section className={`panel sub-rule ${subjectClass(chosen.key)}`}>
          <div className="panel-head">
            <h2 className="serif text-[17px] font-semibold">{chosen.name}</h2>
            <span className="meta num ml-auto">
              {n(chosenSummary.instruments)} with text · {n(chosenSummary.documents)} notifications and circulars
              {chosenSummary.latest ? ` · latest ${fmtDate(chosenSummary.latest)}` : ""}
            </span>
          </div>
          <p className="px-4 pt-2 text-[13px] text-[var(--ink-3)]">{chosen.blurb}</p>
          {chosenGroups.map((g) => (
            <div key={g.kind}>
              <h3 className="eyebrow border-b border-[var(--rule)] px-4 pb-1 pt-3">
                {KIND_LABEL[g.kind] ?? g.kind} <span className="num font-normal">({n(g.items.length)})</span>
              </h3>
              <ul className="feed px-4 py-1">
                {g.items.map((i) => (
                  <li key={i.slug}>
                    <Link
                      href={`/browse/${i.slug}`}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]"
                    >
                      <span className="min-w-0 flex-1 hover:underline">{i.title}</span>
                      <span className="num whitespace-nowrap text-[12px] text-[var(--ink-4)]">
                        {i.pdf_only
                          ? `${n(i.page_count || i.pdf_page_count || 0)} pp PDF`
                          : i.provision_count
                            ? `${n(i.provision_count)} ${unitPlural(i.kind)}`
                            : "text not loaded"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 border-t border-[var(--rule)] px-4 py-2 text-[12.5px]">
            <Link href={`/documents?regulator=${chosen.regulators[0]}`} className="text-[var(--link)] hover:underline">
              {chosen.name} notifications and circulars &rarr;
            </Link>
            <Link href={`/browse?subject=${chosen.key}`} className="text-[var(--link)] hover:underline">
              Full listing with dates &rarr;
            </Link>
          </div>
        </section>
      )}

      {/* --- the one box that answers "where is 80C" ------------------------ */}
      <section className="panel px-6 py-6">
        <h1 className="page-title">Look up any section, rule or regulation</h1>
        <p className="mt-1.5 max-w-3xl text-[13.5px] text-[var(--ink-2)]">
          {n(totals.instruments)} Acts, Rules, Regulations and Master Directions · {n(totals.provisions)} provisions ·{" "}
          {n(totals.documents)} notifications and circulars since 2014. Every screen shows the regulator&rsquo;s own
          text and links to the official document it came from.
        </p>
        <form action="/find" role="search" className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="home-q" className="sr-only">
            Search sections, regulations and notifications
          </label>
          <input
            id="home-q"
            name="q"
            autoFocus
            className="field field-lg min-w-0 flex-1"
            placeholder="A section number, a regulation name, or any phrase — 80C, LODR 17, all-in-cost ceiling"
          />
          <button className="btn btn-primary px-6 text-[15px]">Search</button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-[var(--ink-4)]">Try</span>
          {EXAMPLES.map((e) => (
            <Link key={e.q} href={`/find?q=${encodeURIComponent(e.q)}`} className="chip">
              {e.label}
            </Link>
          ))}
        </div>
      </section>

      {/* --- what's new, split by subject ---------------------------------- */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--rule)] pb-2">
          <h2 className="section-title">What&rsquo;s new, by subject</h2>
          <p className="meta">
            {n(totals.last30)} documents published in the last 30 days ·{" "}
            <Link href="/documents" className="text-[var(--link)] hover:underline">
              every notification and circular
            </Link>
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {(chosen ? subjects.filter((c) => c.subject.key === chosen.key) : subjects).map((c) => (
            <section key={c.subject.key} className={`panel sub-rule ${subjectClass(c.subject.key)} flex flex-col`}>
              <div className="panel-head">
                <h3 className="serif text-[16px] font-semibold">
                  <Link href={`/documents?regulator=${c.subject.regulators[0]}`} className="hover:underline">
                    {c.subject.name}
                  </Link>
                </h3>
                <span className="meta num ml-auto">
                  {c.last30 ? `${n(c.last30)} in 30 days` : c.last90 ? `${n(c.last90)} in 90 days` : "nothing recent"}
                  {c.latest ? ` · latest ${fmtDate(c.latest)}` : ""}
                </span>
              </div>
              <ol className="feed flex-1 px-3 py-1">
                {c.items.map((d) => (
                  <li key={d.id} className="py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="feed-date w-[4.6rem] shrink-0">{fmtDate(d.date_issued) || "no date"}</span>
                      <Link href={`/documents/${d.id}`} className="min-w-0 flex-1 text-[13.5px] hover:underline">
                        {d.title}
                      </Link>
                    </div>
                    <p className="mt-0.5 pl-[5.1rem] text-[12px] text-[var(--ink-3)]">
                      <Affected d={d} />
                    </p>
                  </li>
                ))}
                {c.items.length === 0 && (
                  <li className="py-4 text-[13px] text-[var(--ink-3)]">Nothing recorded for this subject yet.</li>
                )}
              </ol>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--rule)] px-3 py-2 text-[12.5px]">
                <Link href={`/documents?regulator=${c.subject.regulators[0]}`} className="text-[var(--link)] hover:underline">
                  All {n(c.documents)} {c.subject.name} documents
                </Link>
                <Link href={`/browse?subject=${c.subject.key}`} className="text-[var(--link)] hover:underline">
                  {n(c.instruments)} instruments
                </Link>
                {c.effects > 0 && (
                  <span className="ml-auto text-[var(--ink-4)]">{n(c.effects)} recorded amendments</span>
                )}
              </div>
            </section>
          ))}
        </div>
      </section>

      {/* --- open a regulation --------------------------------------------- */}
      <section>
        <div className="mb-3 border-b border-[var(--rule)] pb-2">
          <h2 className="section-title">Open a regulation</h2>
          <p className="meta mt-0.5">
            Each instrument has its own page: what it is, who issued it, when the text is stated as, and everything
            recorded against it.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(chosen ? subjects.filter((c) => c.subject.key === chosen.key) : subjects).map((c) => (
            <article key={c.subject.key} className="panel flex flex-col">
              <div className="panel-head">
                <h3 className="serif text-[16px] font-semibold">
                  <Link href={`/browse?subject=${c.subject.key}`} className="hover:underline">
                    {c.subject.name}
                  </Link>
                </h3>
                <span className="meta num ml-auto">{n(c.instruments)} instruments</span>
              </div>
              <p className="px-3 pt-2 text-[12.5px] leading-snug text-[var(--ink-3)]">{c.subject.blurb}</p>
              <ul className="feed flex-1 px-3 py-2">
                {c.featured.map((i) => (
                  <li key={i.slug}>
                    <Link href={`/browse/${i.slug}`} className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]">
                      <span className="truncate hover:underline" title={i.title}>
                        {shortTitle(i.title)}
                      </span>
                      <span className="num whitespace-nowrap text-[12px] text-[var(--ink-4)]">
                        {i.pdf_only
                          ? `${n(i.page_count || i.pdf_page_count || 0)} pp PDF`
                          : `${n(i.provision_count)} ${unitPlural(i.kind)}`}
                      </span>
                    </Link>
                  </li>
                ))}
                {c.featured.length === 0 && (
                  <li className="py-2 text-[13px] text-[var(--ink-3)]">Not seeded yet.</li>
                )}
              </ul>
              <div className="border-t border-[var(--rule)] px-3 py-2 text-[12.5px]">
                <Link href={`/browse?subject=${c.subject.key}`} className="text-[var(--link)] hover:underline">
                  All {c.subject.name} instruments &rarr;
                </Link>
              </div>
            </article>
          ))}

          <article className="panel flex flex-col">
            <div className="panel-head">
              <h3 className="serif text-[16px] font-semibold">Working tools</h3>
            </div>
            <ul className="feed flex-1 px-3 py-2 text-[13.5px]">
              <li className="py-1.5">
                <Link href="/compare/income-tax" className="hover:underline">
                  Income-tax Act 1961 &harr; 2025 mapping
                </Link>
                <p className="text-[12px] text-[var(--ink-3)]">CBDT&rsquo;s own concordance, section by section.</p>
              </li>
              <li className="py-1.5">
                <Link href="/documents" className="hover:underline">
                  Notifications, circulars and gazette copies
                </Link>
                <p className="text-[12px] text-[var(--ink-3)]">Filter by regulator, instrument, type and date; export CSV.</p>
              </li>
              <li className="py-1.5">
                <Link href="/browse" className="hover:underline">
                  Every tracked instrument
                </Link>
                <p className="text-[12px] text-[var(--ink-3)]">Acts, Rules, Regulations and Master Directions in one list.</p>
              </li>
              <li className="py-1.5">
                <Link href="/status" className="hover:underline">
                  Collection status
                </Link>
                <p className="text-[12px] text-[var(--ink-3)]">What ran, what failed, and what needs a second look.</p>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}

// What a document did, in the reader's terms — never guessed: either instruments we tagged it to, or
// the document type the regulator gave it.
function Affected({ d }: { d: FeedItem }) {
  if (d.affects) {
    return (
      <>
        amends <span className="font-medium text-[var(--ink-2)]">{d.affects}</span>
        {d.effects > 0 ? ` · ${d.effects} provision${d.effects === 1 ? "" : "s"} changed` : ""}
      </>
    );
  }
  const type = DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type.replace(/_/g, " ");
  return <>{d.is_amending === false ? `${type} · not amending` : type}</>;
}
