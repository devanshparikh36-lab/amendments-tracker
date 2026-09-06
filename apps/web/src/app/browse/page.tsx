import Link from "next/link";
import { KIND_LABEL, REGULATOR_LABEL, SUBJECTS } from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { instrumentIndex } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KIND_ORDER = ["act", "rules", "regulations", "master_direction", "master_circular", "scheme", "other"];

type Search = Promise<{ q?: string; regulator?: string; subject?: string; seeded?: string }>;

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
      (sp.seeded !== "1" || i.provision_count > 0),
  );

  const groups = SUBJECTS.map((s) => ({
    subject: s,
    items: instruments
      .filter((i) => s.regulators.includes(i.regulator_code))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.provision_count - a.provision_count || a.title.localeCompare(b.title)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[19px] font-semibold tracking-tight">Acts, Rules, Regulations and Master Directions</h1>
        <p className="text-sm text-stone-600">
          {instruments.length} of {all.length} tracked ·{" "}
          {instruments.reduce((n, i) => n + i.provision_count, 0).toLocaleString("en-IN")} provisions
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-1.5 text-[13px]">
        <Link
          href="/browse"
          className={`rounded-full border px-3 py-1 ${!subject ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 hover:bg-stone-100"}`}
        >
          All subjects
        </Link>
        {SUBJECTS.map((s) => (
          <Link
            key={s.key}
            href={`/browse?subject=${s.key}`}
            className={`rounded-full border px-3 py-1 ${
              subject?.key === s.key ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 hover:bg-stone-100"
            }`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      <form className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
        {subject && <input type="hidden" name="subject" value={subject.key} />}
        <label className="flex flex-col text-xs text-stone-500">
          Find a regulation
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="LODR, ECB, incorporation"
            className="w-64 rounded border border-stone-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-600">
          <input type="checkbox" name="seeded" value="1" defaultChecked={sp.seeded === "1"} /> only those with text
        </label>
        <button className="rounded bg-stone-800 px-3 py-1.5 text-white">Filter</button>
        {(sp.q || sp.regulator || sp.seeded) && (
          <Link href={subject ? `/browse?subject=${subject.key}` : "/browse"} className="text-sm text-stone-600 hover:underline">
            clear
          </Link>
        )}
      </form>

      {groups.map((g) => (
        <section key={g.subject.key}>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">
            {g.subject.name} <span className="font-normal normal-case text-stone-400">({g.items.length})</span>
          </h2>
          <div className="scroll-x rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Issued by</th>
                  <th className="px-3 py-2">Text as on</th>
                  <th className="px-3 py-2 text-right">{g.subject.unit === "section" ? "Sections" : "Provisions"}</th>
                  <th className="px-3 py-2 text-right">Documents</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => (
                  <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-1.5">
                      <Link href={`/browse/${i.slug}`} className="font-medium text-stone-900 hover:underline">
                        {i.title}
                      </Link>
                      {i.provision_count === 0 && <span className="ml-2 text-xs text-stone-400">text not loaded yet</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-stone-600">{KIND_LABEL[i.kind] ?? i.kind}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-stone-600">
                      {REGULATOR_LABEL[i.regulator_code] ?? i.regulator_code}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-stone-600">{fmtDate(i.official_updated_as_on)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.provision_count || ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {i.doc_count ? (
                        <Link href={`/documents?instrument=${i.slug}`} className="hover:underline">
                          {i.doc_count}
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
      {instruments.length === 0 && <p className="text-stone-500">Nothing matches that filter.</p>}
    </div>
  );
}
