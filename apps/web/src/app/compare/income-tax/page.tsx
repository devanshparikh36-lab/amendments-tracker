import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { provisionHref } from "@/lib/lookup";
import { mapCounts, mapEntries, provisionText } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Income-tax Act 1961 â†” 2025" };

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
    rows.find((r) => (sp.old && r.old_number === sp.old) || (sp.new && r.new_number === sp.new)) ??
    (sp.old || sp.new ? undefined : rows[0]);

  const [oldProv, newProv] = selected
    ? await Promise.all([
        selected.old_number ? provisionText(selected.old_instrument, selected.old_number) : Promise.resolve(null),
        selected.new_number ? provisionText(selected.new_instrument, selected.new_number) : Promise.resolve(null),
      ])
    : [null, null];

  const showDiff = sp.view === "diff" && oldProv && newProv;

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--rule)] pb-3">
        <h1 className="page-title">Income-tax Act 1961 compared with the Act of 2025</h1>
        <p className="meta mt-1 max-w-3xl">
          The mapping published by the Central Board of Direct Taxes. The Income-tax Act, 2025 came into force on 1
          April 2026; Rules 1962 and Rules 2026 are included. Text on both sides is the department&rsquo;s own.
        </p>
        <div className="meta num mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>{counts?.total ?? 0} mapped entries</span>
          <span>{counts?.sections ?? 0} sections</span>
          <span>{counts?.rules ?? 0} rules and forms</span>
          {counts?.dropped ? (
            <span className="text-[var(--flag-alert)]">{counts.dropped} with no counterpart in 2025</span>
          ) : null}
          {counts?.added ? <span className="text-[var(--flag-official)]">{counts.added} new in 2025</span> : null}
        </div>
      </div>

      <form className="no-print panel flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Find a section, rule or subject
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="80C, depreciation, Form 3CD"
            className="field mt-0.5 w-72"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Type
          <select name="entity" defaultValue={sp.entity ?? ""} className="field mt-0.5">
            <option value="">All</option>
            <option value="section">Sections</option>
            <option value="rule">Rules</option>
            <option value="form">Forms</option>
          </select>
        </label>
        <button className="btn btn-primary">Search</button>
        <a
          href={`/api/export/section-map?q=${encodeURIComponent(sp.q ?? "")}`}
          className="ml-auto text-[13px] text-[var(--link)] hover:underline"
        >
          Export CSV
        </a>
      </form>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="panel max-h-[75vh] overflow-y-auto">
          <table className="dtable">
            <thead className="sticky top-0">
              <tr>
                <th>1961 / 1962</th>
                <th>2025 / 2026</th>
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
                  <tr key={r.id} className={active ? "bg-[var(--ground-sunk)]" : ""}>
                    <td className="num">
                      <Link href={href} className={`block ${active ? "font-semibold" : ""}`}>
                        {r.old_number ?? <span className="text-[var(--flag-official)]">new</span>}
                      </Link>
                    </td>
                    <td className="num">
                      <Link href={href} className={`block ${active ? "font-semibold" : ""}`}>
                        {r.new_number ?? <span className="text-[var(--flag-alert)]">no counterpart</span>}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-8 text-center text-[var(--ink-3)]">
                    {counts?.total ? "No entry matches." : "Mapping not loaded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </aside>

        <section className="min-w-0 space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <span className="num font-semibold">
                  {selected.old_number ?? "â€”"} &rarr; {selected.new_number ?? "â€”"}
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
                    className="btn ml-auto"
                  >
                    {sp.view === "diff" ? "Side by side" : "Show differences"}
                  </Link>
                )}
              </div>

              {showDiff ? (
                <div className="panel panel-body">
                  <p className="meta mb-2">Removed text is the 1961 wording; added text is the 2025 wording.</p>
                  <Diff before={oldProv!.text} after={newProv!.text} />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    {
                      p: oldProv,
                      label: INSTRUMENT_LABEL[selected.old_instrument],
                      num: selected.old_number,
                      title: selected.old_title,
                      slug: selected.old_instrument,
                    },
                    {
                      p: newProv,
                      label: INSTRUMENT_LABEL[selected.new_instrument],
                      num: selected.new_number,
                      title: selected.new_title,
                      slug: selected.new_instrument,
                    },
                  ].map((side, i) => (
                    <div key={i} className="panel">
                      <div className="panel-head">
                        <div>
                          <div className="eyebrow">{side.label}</div>
                          <div className="num font-semibold">
                            {side.num ? (
                              <Link href={provisionHref(side.slug, side.num)} className="hover:underline">
                                {side.num}
                              </Link>
                            ) : (
                              "No counterpart"
                            )}
                          </div>
                          {side.title && <div className="meta">{side.title}</div>}
                        </div>
                      </div>
                      <div className="panel-body">
                        {side.p ? (
                          <div className="legal-pre max-h-[55vh] overflow-y-auto">{side.p.text}</div>
                        ) : (
                          <p className="text-[13.5px] text-[var(--ink-3)]">
                            {side.num ? "Text not seeded yet for this provision." : "This provision has no counterpart."}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="panel border-dashed p-8 text-center text-[var(--ink-3)]">
              Pick an entry on the left, or search for a section number or subject.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
