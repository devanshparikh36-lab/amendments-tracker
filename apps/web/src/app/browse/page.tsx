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
          <div className="scroll-x">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Issued by</th>
                  <th>Text as on</th>
                  <th className="text-right">Contents</th>
                  <th className="text-right">Documents</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/browse/${i.slug}`} className="font-medium hover:underline">
                        {i.title}
                      </Link>
                      {i.pdf_only ? (
                        <span className="ml-2 text-[11.5px] text-[var(--ink-3)]">served as the official PDF</span>
                      ) : (
                        i.provision_count === 0 && (
                          <span className="ml-2 text-[11.5px] text-[var(--ink-4)]">text not loaded yet</span>
                        )
                      )}
                    </td>
                    <td className="whitespace-nowrap text-[var(--ink-2)]">{KIND_LABEL[i.kind] ?? i.kind}</td>
                    <td className="whitespace-nowrap text-[var(--ink-2)]">
                      {REGULATOR_LABEL[i.regulator_code] ?? i.regulator_code}
                    </td>
                    <td className="num whitespace-nowrap text-[var(--ink-2)]">{fmtDate(i.official_updated_as_on)}</td>
                    <td className="num whitespace-nowrap text-right text-[var(--ink-2)]">
                      {i.pdf_only
                        ? `${n(i.page_count || i.pdf_page_count || 0)} pages`
                        : i.provision_count
                          ? `${n(i.provision_count)} ${unitPlural(i.kind)}`
                          : ""}
                    </td>
                    <td className="num text-right">
                      {i.doc_count ? (
                        <Link href={`/documents?instrument=${i.slug}`} className="hover:underline">
                          {n(i.doc_count)}
                        </Link>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {instruments.length === 0 && (
        <p className="panel border-dashed p-8 text-center text-[var(--ink-3)]">Nothing matches that filter.</p>
      )}
    </div>
  );
}
