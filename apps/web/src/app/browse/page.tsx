import Link from "next/link";
import { KIND_LABEL, REGULATOR_LABEL, SUBJECTS, subjectClass, unitPlural } from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { instrumentIndex } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Acts, Rules, Regulations and Master Directions" };

const KIND_ORDER = ["act", "rules", "regulations", "master_direction", "master_circular", "scheme", "other"];

type Search = Promise<{ q?: string; regulator?: string; subject?: string; seeded?: string }>;

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

export default async function BrowsePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const all = await instrumentIndex();
  const q = (sp.q ?? "").trim().toLowerCase();
  const subject = SUBJECTS.find((s) => s.key === sp.subject);

  const instruments = all.filter(
    (i) =>
      (!subject || subject.regulators.includes(i.regulator_code)) &&
      (!sp.regulator || i.regulator_code === sp.regulator) &&
      (!q || i.title.toLowerCase().includes(q) || i.short_code.toLowerCase().includes(q) || i.slug.includes(q)) &&
      (sp.seeded !== "1" || i.provision_count > 0 || (i.pdf_only && i.page_count > 0)),
  );

  const groups = SUBJECTS.map((s) => ({
    subject: s,
    items: instruments
      .filter((i) => s.regulators.includes(i.regulator_code))
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          b.provision_count - a.provision_count ||
          a.title.localeCompare(b.title),
      ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--rule)] pb-3">
        <div>
          <h1 className="page-title">Acts, Rules, Regulations and Master Directions</h1>
          <p className="meta mt-1">
            Every instrument has its own page — what it is, who issued it, and what has amended it.
          </p>
        </div>
        <p className="meta num">
          {n(instruments.length)} of {n(all.length)} tracked ·{" "}
          {n(instruments.reduce((t, i) => t + (i.pdf_only ? 0 : i.provision_count), 0))} provisions ·{" "}
          {n(instruments.reduce((t, i) => t + (i.pdf_only ? i.page_count : 0), 0))} official PDF pages
        </p>
      </div>

      <div className="no-print flex flex-wrap items-center gap-1.5">
        <Link href="/browse" className={`chip ${!subject ? "chip-on" : ""}`}>
          All subjects
        </Link>
        {SUBJECTS.map((s) => (
          <Link
            key={s.key}
            href={`/browse?subject=${s.key}`}
            className={`chip ${subject?.key === s.key ? "chip-on" : ""}`}
          >
            {s.name}
          </Link>
        ))}
        <form className="ml-auto flex flex-wrap items-center gap-2">
          {subject && <input type="hidden" name="subject" value={subject.key} />}
          <label htmlFor="browse-q" className="sr-only">
            Find a regulation
          </label>
          <input
            id="browse-q"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="LODR, ECB, incorporation"
            className="field w-56"
          />
          <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]">
            <input type="checkbox" name="seeded" value="1" defaultChecked={sp.seeded === "1"} /> only with text
          </label>
          <button className="btn">Filter</button>
          {(sp.q || sp.regulator || sp.seeded) && (
            <Link
              href={subject ? `/browse?subject=${subject.key}` : "/browse"}
              className="text-[12.5px] text-[var(--ink-3)] hover:underline"
            >
              clear
            </Link>
          )}
        </form>
      </div>

      {groups.map((g) => (
        <section key={g.subject.key} className={`panel sub-rule ${subjectClass(g.subject.key)}`}>
          <div className="panel-head">
            <h2 className="serif text-[16px] font-semibold">{g.subject.name}</h2>
            <span className="meta num ml-auto">{n(g.items.length)} instruments</span>
          </div>
          <ul className="px-5 py-2">
            {g.items.map((i) => (
              <li key={i.id} className="border-b border-[var(--rule)] py-2.5 last:border-b-0">
                <Link href={`/browse/${i.slug}`} className="text-[14px] hover:underline">
                  {i.title}
                </Link>
                <p className="meta mt-0.5">
                  {KIND_LABEL[i.kind] ?? i.kind} · {REGULATOR_LABEL[i.regulator_code] ?? i.regulator_code}
                  {i.official_updated_as_on && <> · text as on {fmtDate(i.official_updated_as_on)}</>}
                  {i.pdf_only ? (
                    <> · served as the official PDF{i.page_count ? `, ${n(i.page_count)} pages` : ""}</>
                  ) : i.provision_count ? (
                    <> · {n(i.provision_count)} {unitPlural(i.kind)}</>
                  ) : (
                    <> · text not loaded yet</>
                  )}
                  {i.doc_count > 0 && (
                    <>
                      {" · "}
                      <Link href={`/documents?instrument=${i.slug}`} className="text-[var(--link)] hover:underline">
                        {n(i.doc_count)} document{i.doc_count === 1 ? "" : "s"}
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {instruments.length === 0 && (
        <p className="panel border-dashed p-8 text-center text-[var(--ink-3)]">Nothing matches that filter.</p>
      )}
    </div>
  );
}
