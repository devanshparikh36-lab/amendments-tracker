import { provisionHref } from "@/lib/format";
﻿import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { mapCounts, mapEntries, provisionText } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Income-tax Act 1961 ↔ 2025" };

type Search = Promise<{ q?: string; entity?: string; old?: string; new?: string; view?: string }>;

const INSTRUMENT_LABEL: Record<string, string> = {
  "ita-1961": "Income-tax Act, 1961",
  "ita-2025": "Income-tax Act, 2025",
  "itr-1962": "Income-tax Rules, 1962",
  "itr-2026": "Income-tax Rules, 2026",
};

// One box, and a comparison. Not a wall of pairs.
//
// This page used to open with 250 rows of "20 -> 331, 59 -> 189, 20A -> 331 ..." beside the text, and
// scrolling that list was the only way in. The list is not the thing anyone came for: a reader arrives
// knowing a section -- 80C, or 139, or rule 12 -- and wants its counterpart. So nothing is listed until
// something is asked for, and what comes back is the comparison itself, with a short disambiguation only
// where a section genuinely maps to more than one place.
const EXAMPLES = ["80C", "139", "10(23C)", "rule 12", "depreciation"];

export default async function ComparePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const [counts, rows] = await Promise.all([
    mapCounts("income-tax"),
    // Nothing is fetched until something is asked for.
    q || sp.old || sp.new
      ? mapEntries("income-tax", { q: q || undefined, entity: sp.entity, limit: 60 })
      : Promise.resolve([]),
  ]);

  // An exact number on either side wins over a title that merely contains the word: someone typing "139"
  // means section 139, not every provision whose heading mentions it.
  const norm = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, "").toLowerCase();
  const target = norm(q);
  // Two different kinds of hit, kept apart because conflating them lies about the mapping. Searching "80C"
  // matches three entries that really are section 80C, and fifteen more whose *heading* happens to cite it
  // -- rule 20 is "Guidelines for approval under clause (xix) of sub-section (2) of section 80C". Counting
  // all eighteen as "80C maps to 18 entries" is simply untrue, and burying the three among the fifteen is
  // how the old table felt chaotic.
  const isNumberHit = (r: (typeof rows)[number]) => norm(r.old_number) === target || norm(r.new_number) === target;
  const numbered = rows.filter(isNumberHit).sort((a, b) => a.sort_order - b.sort_order);
  const mentions = rows.filter((r) => !isNumberHit(r)).sort((a, b) => a.sort_order - b.sort_order);
  const ranked = numbered.length ? numbered : mentions;

  const picked =
    [...numbered, ...mentions].find((r) => (sp.old && r.old_number === sp.old) || (sp.new && r.new_number === sp.new)) ??
    null;
  // With one match, show it. With several, let the reader choose -- but still show the first, so the page
  // answers rather than asking.
  const selected = picked ?? ranked[0] ?? undefined;
  const alternatives = picked ? [] : ranked.slice(1, 12);
  const alsoMentioned = numbered.length ? mentions.slice(0, 10) : [];

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
        <Breadcrumbs trail={[{ label: "Acts & Rules", href: "/browse" }, { label: "Compare 1961 ↔ 2025" }]} />
        <h1 className="page-title mt-1">Income-tax Act 1961 compared with the Act of 2025</h1>
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
          Section or rule, from either Act
          <input
            name="q"
            defaultValue={q}
            autoFocus={!q}
            placeholder="80C, 139, rule 12, depreciation"
            className="field mt-0.5 w-80"
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
        <button className="btn btn-primary">Compare</button>
        {q && (
          <Link href="/compare/income-tax" className="text-[12.5px] text-[var(--ink-3)] hover:underline">
            clear
          </Link>
        )}
        <a
          href={`/api/export/section-map?q=${encodeURIComponent(q)}`}
          className="ml-auto text-[13px] text-[var(--link)] hover:underline"
        >
          Export the full mapping (CSV)
        </a>
      </form>

      {!q && !sp.old && !sp.new && (
        <div className="panel border-dashed p-8 text-center">
          <p className="text-[14px] text-[var(--ink-2)]">
            Type a section or rule from either Act and its counterpart in the other is shown beside it.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {EXAMPLES.map((e) => (
              <Link key={e} href={`/compare/income-tax?q=${encodeURIComponent(e)}`} className="chip">
                {e}
              </Link>
            ))}
          </div>
        </div>
      )}

      {q && ranked.length === 0 && (
        <p className="panel border-dashed p-8 text-center text-[var(--ink-3)]">
          {counts?.total
            ? `Nothing in CBDT’s mapping matches “${q}”.`
            : "The mapping has not been loaded yet."}
        </p>
      )}

      {alternatives.length > 0 && (
        <div className="panel panel-body">
          <p className="meta">
            {numbered.length
              ? `${q} maps to ${ranked.length} places. Showing the first; the others are:`
              : `Nothing is numbered ${q}. These headings mention it:`}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {alternatives.map((r) => (
              <Link
                key={r.id}
                href={`/compare/income-tax?${new URLSearchParams({
                  q,
                  ...(sp.entity ? { entity: sp.entity } : {}),
                  ...(r.old_number ? { old: r.old_number } : { new: r.new_number ?? "" }),
                })}`}
                className="chip num"
              >
                {r.old_number ?? "new"} &rarr; {r.new_number ?? "none"}
              </Link>
            ))}
          </div>
        </div>
      )}

      {alsoMentioned.length > 0 && (
        <details className="panel panel-body">
          <summary className="meta cursor-pointer">
            {alsoMentioned.length} other provision{alsoMentioned.length === 1 ? "" : "s"} mention{" "}
            {alsoMentioned.length === 1 ? "s" : ""} {q} in their heading
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {alsoMentioned.map((r) => (
              <Link
                key={r.id}
                href={`/compare/income-tax?${new URLSearchParams({
                  q,
                  ...(sp.entity ? { entity: sp.entity } : {}),
                  ...(r.old_number ? { old: r.old_number } : { new: r.new_number ?? "" }),
                })}`}
                className="chip num"
              >
                {r.old_number ?? "new"} &rarr; {r.new_number ?? "none"}
              </Link>
            ))}
          </div>
        </details>
      )}

      <div className="min-w-0">
        <section className="min-w-0 space-y-3">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <span className="num font-semibold">
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
          ) : null}
        </section>
      </div>
    </div>
  );
}
