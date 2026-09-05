import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { mapCounts, mapEntries, provisionText } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; entity?: string; old?: string; new?: string; view?: string }>;

const INSTRUMENT_LABEL: Record<string, string> = {
  "ita-1961": "Income-tax Act, 1961",
  "ita-2025": "Income-tax Act, 2025",
  "itr-1962": "Income-tax Rules, 1962",
  "itr-2026": "Income-tax Rules, 2026",
};

export default async function ComparePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const [counts, rows] = await Promise.all([
    mapCounts("income-tax"),
    mapEntries("income-tax", { q: sp.q, entity: sp.entity, limit: sp.q ? 400 : 250 }),
  ]);

  const selected =
    rows.find((r) => (sp.old && r.old_number === sp.old) || (sp.new && r.new_number === sp.new)) ?? (sp.old || sp.new ? undefined : rows[0]);

  const [oldProv, newProv] = selected
    ? await Promise.all([
        selected.old_number ? provisionText(selected.old_instrument, selected.old_number) : Promise.resolve(null),
        selected.new_number ? provisionText(selected.new_instrument, selected.new_number) : Promise.resolve(null),
      ])
    : [null, null];

  const showDiff = sp.view === "diff" && oldProv && newProv;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Income-tax Act 1961 compared with Act 2025</h1>
        <p className="text-sm text-stone-600">
          Mapping published by the Central Board of Direct Taxes. The Income-tax Act, 2025 came into force on 1 April
          2026. Rules 1962 and Rules 2026 are included.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-stone-600">
          <span>{counts?.total ?? 0} mapped entries</span>
          <span>{counts?.sections ?? 0} sections</span>
          <span>{counts?.rules ?? 0} rules and forms</span>
          {counts?.dropped ? <span className="text-red-700">{counts.dropped} with no counterpart in 2025</span> : null}
          {counts?.added ? <span className="text-emerald-700">{counts.added} new in 2025</span> : null}
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
        <label className="flex flex-col text-xs text-stone-500">
          Find a section, rule or subject
          <input name="q" defaultValue={sp.q ?? ""} placeholder="80C, depreciation, Form 3CD" className="w-72 rounded border border-stone-300 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-stone-500">
          Type
          <select name="entity" defaultValue={sp.entity ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="section">Sections</option>
            <option value="rule">Rules</option>
            <option value="form">Forms</option>
          </select>
        </label>
        <button className="rounded bg-stone-800 px-3 py-1.5 text-white">Search</button>
        <a href={`/api/export/section-map?q=${encodeURIComponent(sp.q ?? "")}`} className="ml-auto text-sky-700 hover:underline">
          Export CSV
        </a>
      </form>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="max-h-[75vh] overflow-y-auto rounded-lg border border-stone-200 bg-white text-sm">
          <table className="w-full">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-1.5">1961 / 1962</th>
                <th className="px-2 py-1.5">2025 / 2026</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const active = selected?.id === r.id;
                const href = `/compare/income-tax?${new URLSearchParams({
                  ...(sp.q ? { q: sp.q } : {}),
                  ...(sp.entity ? { entity: sp.entity } : {}),
                  ...(r.old_number ? { old: r.old_number } : { new: r.new_number ?? "" }),
                  ...(sp.view ? { view: sp.view } : {}),
                })}`;
                return (
                  <tr key={r.id} className={`border-t border-stone-100 ${active ? "bg-stone-100" : "hover:bg-stone-50"}`}>
                    <td className="px-2 py-1.5 align-top">
                      <Link href={href} className={`block ${active ? "font-semibold" : ""}`}>
                        {r.old_number ?? <span className="text-emerald-700">new</span>}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Link href={href} className={`block ${active ? "font-semibold" : ""}`}>
                        {r.new_number ?? <span className="text-red-700">no counterpart</span>}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-8 text-center text-stone-500">
                    {counts?.total ? "No entry matches." : "Mapping not loaded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </aside>

        <section className="space-y-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">
                  {selected.old_number ?? "—"} &rarr; {selected.new_number ?? "—"}
                </span>
                <Badge kind={selected.entity_type === "section" ? "amends" : "clarifies"}>{selected.entity_type}</Badge>
                {!selected.new_number && <Badge kind="cannot_apply">no counterpart in 2025</Badge>}
                {!selected.old_number && <Badge kind="merged">new in 2025</Badge>}
                {oldProv && newProv && (
                  <Link
                    href={`/compare/income-tax?${new URLSearchParams({
                      ...(sp.q ? { q: sp.q } : {}),
                      ...(sp.entity ? { entity: sp.entity } : {}),
                      ...(selected.old_number ? { old: selected.old_number } : {}),
                      ...(sp.view === "diff" ? {} : { view: "diff" }),
                    })}`}
                    className="ml-auto text-sky-700 hover:underline"
                  >
                    {sp.view === "diff" ? "side by side" : "show differences"}
                  </Link>
                )}
              </div>

              {showDiff ? (
                <div className="rounded-lg border border-stone-200 bg-white p-4">
                  <p className="mb-2 text-xs text-stone-500">
                    Removed text is the 1961 wording; added text is the 2025 wording.
                  </p>
                  <Diff before={oldProv!.text} after={newProv!.text} />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    { p: oldProv, label: INSTRUMENT_LABEL[selected.old_instrument], num: selected.old_number, title: selected.old_title, slug: selected.old_instrument },
                    { p: newProv, label: INSTRUMENT_LABEL[selected.new_instrument], num: selected.new_number, title: selected.new_title, slug: selected.new_instrument },
                  ].map((side, i) => (
                    <div key={i} className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="mb-2 border-b border-stone-100 pb-2">
                        <div className="text-xs uppercase tracking-wide text-stone-500">{side.label}</div>
                        <div className="font-semibold">
                          {side.num ? (
                            <Link href={`/browse/${side.slug}?p=${encodeURIComponent(side.num)}`} className="hover:underline">
                              {side.num}
                            </Link>
                          ) : (
                            "No counterpart"
                          )}
                        </div>
                        {side.title && <div className="text-sm text-stone-600">{side.title}</div>}
                      </div>
                      {side.p ? (
                        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{side.p.text}</pre>
                      ) : (
                        <p className="text-sm text-stone-500">
                          {side.num ? "Text not seeded yet for this provision." : "This provision has no counterpart."}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-stone-500">
              Pick an entry on the left, or search for a section number or subject.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
