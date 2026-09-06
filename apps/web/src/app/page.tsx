import Link from "next/link";
import { SUBJECTS } from "@/lib/catalogue";
import { DOC_TYPE_LABEL, fmtDate } from "@/lib/format";
import { documentCountsByRegulator, instrumentIndex, listDocuments, type InstrumentRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  { q: "80C", label: "section 80C" },
  { q: "regulation 17 LODR", label: "regulation 17 LODR" },
  { q: "rule 8 incorporation", label: "rule 8 incorporation" },
  { q: "section 16 CGST", label: "section 16 CGST" },
  { q: "ECB", label: "ECB Master Direction" },
];

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

export default async function Home() {
  const [instruments, docCounts, recent] = await Promise.all([
    instrumentIndex(),
    documentCountsByRegulator(),
    listDocuments({ limit: 12 }),
  ]);

  const bySlug = new Map(instruments.map((i) => [i.slug, i]));
  const docsByReg = new Map(docCounts.map((d) => [d.regulator_code, d]));

  const cards = SUBJECTS.map((s) => {
    const mine = instruments.filter((i) => s.regulators.includes(i.regulator_code));
    const seeded = mine.filter((i) => i.provision_count > 0);
    const featured: InstrumentRow[] = [];
    for (const slug of s.featured) {
      const inst = bySlug.get(slug);
      if (inst && inst.provision_count > 0) featured.push(inst);
    }
    for (const inst of seeded) {
      if (featured.length >= 8) break;
      if (!featured.some((f) => f.slug === inst.slug)) featured.push(inst);
    }
    return {
      subject: s,
      featured,
      instruments: seeded.length,
      provisions: mine.reduce((t, i) => t + i.provision_count, 0),
      documents: s.regulators.reduce((t, r) => t + (docsByReg.get(r)?.documents ?? 0), 0),
      latest: s.regulators.map((r) => docsByReg.get(r)?.latest).filter(Boolean).sort().pop() ?? null,
    };
  });

  const totals = {
    instruments: instruments.filter((i) => i.provision_count > 0).length,
    provisions: instruments.reduce((t, i) => t + i.provision_count, 0),
    documents: docCounts.reduce((t, d) => t + d.documents, 0),
  };

  return (
    <div className="space-y-9">
      <section className="rounded-lg border border-stone-200 bg-white px-6 py-7 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <h1 className="text-[22px] font-semibold tracking-tight text-stone-900">
          Look up any section, rule or regulation
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          {n(totals.instruments)} Acts, Rules, Regulations and Master Directions · {n(totals.provisions)} provisions ·{" "}
          {n(totals.documents)} notifications and circulars since 2014, with the official text alongside.
        </p>
        <form action="/find" role="search" className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="home-q" className="sr-only">
            Search sections, regulations and notifications
          </label>
          <input
            id="home-q"
            name="q"
            autoFocus
            placeholder="Type a section number, a regulation name, or any phrase — e.g. 80C, LODR 17, all-in-cost ceiling"
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-4 py-3 text-base placeholder:text-stone-400 focus:border-stone-600 focus:outline-none"
          />
          <button className="rounded-md bg-[var(--accent)] px-6 py-3 text-base font-medium text-white hover:bg-[#173618]">
            Search
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span className="text-stone-500">Try:</span>
          {EXAMPLES.map((e) => (
            <Link
              key={e.q}
              href={`/find?q=${encodeURIComponent(e.q)}`}
              className="rounded-full border border-stone-300 px-2.5 py-1 hover:border-stone-500 hover:bg-stone-50"
            >
              {e.label}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-stone-500">Open a regulation</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <article key={c.subject.key} className="flex flex-col rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[17px] font-semibold text-stone-900">
                  <Link href={`/browse?subject=${c.subject.key}`} className="hover:underline">
                    {c.subject.name}
                  </Link>
                </h3>
                <span className="whitespace-nowrap text-xs text-stone-500">{n(c.instruments)} instruments</span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-stone-600">{c.subject.blurb}</p>
              <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-100">
                {c.featured.map((i) => (
                  <li key={i.slug}>
                    <Link
                      href={`/browse/${i.slug}`}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-sm hover:bg-stone-50"
                    >
                      <span className="truncate text-stone-800 hover:underline" title={i.title}>
                        {shortTitle(i)}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-stone-400">
                        {n(i.provision_count)} {unitLabel(i.kind)}
                      </span>
                    </Link>
                  </li>
                ))}
                {c.featured.length === 0 && <li className="py-2 text-sm text-stone-500">Not seeded yet.</li>}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <Link href={`/browse?subject=${c.subject.key}`} className="text-[var(--link)] hover:underline">
                  All {c.subject.name} instruments
                </Link>
                <Link
                  href={`/documents?regulator=${c.subject.regulators[0]}`}
                  className="text-[var(--link)] hover:underline"
                >
                  {n(c.documents)} notifications
                </Link>
                {c.latest && <span className="ml-auto text-xs text-stone-400">latest {fmtDate(c.latest)}</span>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">Recent amendments</h2>
          <Link href="/documents" className="text-[13px] text-[var(--link)] hover:underline">
            All notifications and circulars
          </Link>
        </div>
        <ol className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {recent.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 hover:bg-stone-50">
              <span className="w-24 shrink-0 whitespace-nowrap text-xs tabular-nums text-stone-500">
                {fmtDate(d.date_issued)}
              </span>
              <span className="w-16 shrink-0 text-xs font-medium text-stone-500">{d.regulator_code}</span>
              <Link href={`/documents/${d.id}`} className="min-w-0 flex-1 text-sm text-stone-800 hover:underline">
                {d.title}
              </Link>
              <span className="whitespace-nowrap text-xs text-stone-500">
                {d.affects ? `affects ${d.affects}` : (DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type)}
              </span>
            </li>
          ))}
          {recent.length === 0 && <li className="px-4 py-6 text-sm text-stone-500">No documents yet.</li>}
        </ol>
      </section>
    </div>
  );
}

function unitLabel(kind: string): string {
  if (kind === "rules") return "rules";
  if (kind === "regulations") return "regulations";
  if (kind === "master_direction" || kind === "master_circular") return "paragraphs";
  return "sections";
}

// Cards list many instruments from one family; drop the boilerplate prefix so the distinguishing words show.
function shortTitle(i: InstrumentRow): string {
  return i.title
    .replace(/^Securities and Exchange Board of India\s*/i, "SEBI ")
    .replace(/^Foreign Exchange Management\s*/i, "FEM ")
    .replace(/^Master Direction\s*[–-]\s*/i, "")
    .replace(/^The\s+/i, "")
    .trim();
}
