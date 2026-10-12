import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import {
  GROUP_HEADING,
  KIND_LABEL,
  REGULATOR_LABEL,
  SUBJECTS,
  instrumentGroup,
  subjectClass,
  supersededBy,
  unitPlural,
} from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { instrumentIndex } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Acts, Rules, Regulations and Master Directions" };

const KIND_ORDER = ["act", "rules", "regulations", "master_direction", "master_circular", "scheme", "other"];

type Search = Promise<{ q?: string; regulator?: string; subject?: string; seeded?: string; superseded?: string }>;

function n(v: number): string {
  return v.toLocaleString("en-IN");
}

export default async function BrowsePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const all = await instrumentIndex();
  const q = (sp.q ?? "").trim().toLowerCase();
  const subject = SUBJECTS.find((s) => s.key === sp.subject);

  // What the regulator has replaced is hidden by default: a reader looking up the law wants the one in
  // force, and an older text sitting beside it in the same list is the one way this site could actively
  // mislead. Nothing is removed -- the toggle below brings them back, and their own pages still work and
  // still say what replaced them.
  const showSuperseded = sp.superseded === "1";
  const matches = all.filter(
    (i) =>
      (!subject || subject.regulators.includes(i.regulator_code)) &&
      (!sp.regulator || i.regulator_code === sp.regulator) &&
      (!q || i.title.toLowerCase().includes(q) || i.short_code.toLowerCase().includes(q) || i.slug.includes(q)) &&
      (sp.seeded !== "1" || i.provision_count > 0 || (i.pdf_only && i.page_count > 0)),
  );
  const supersededCount = matches.filter((i) => supersededBy(i.slug)).length;
  const instruments = showSuperseded ? matches : matches.filter((i) => !supersededBy(i.slug));

  // The unfiltered view shows a preview of each subject rather than all 198 instruments at once. A React
  // server component ships its rendered tree twice -- once as HTML, once as the flight payload it is escaped
  // into -- so the full list cost 603 KB to answer "what is here?", most of it for rows nobody scrolled to.
  // Narrowing by subject, regulator or search shows everything that matches, so nothing becomes unreachable.
  const PREVIEW_PER_SUBJECT = 12;
  const narrowed = Boolean(subject || sp.regulator || q || sp.seeded === "1");

  const groups = SUBJECTS.map((s) => {
    const items = instruments
      .filter((i) => s.regulators.includes(i.regulator_code))
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          b.provision_count - a.provision_count ||
          a.title.localeCompare(b.title),
      );
    // Each subject is shown as Acts first, then Rules & Regulations, under their own headings. The preview
    // budget is spent per group rather than per subject, so a subject with one Act and ninety regulations
    // still shows the Act -- previously the Act could be pushed off the end by its own rules.
    const shown = narrowed ? items : null;
    const take = (which: "acts" | "rules") => {
      const of = items.filter((i) => instrumentGroup(i.kind) === which);
      return { total: of.length, items: shown ? of : of.slice(0, PREVIEW_PER_SUBJECT) };
    };
    return { subject: s, total: items.length, acts: take("acts"), rules: take("rules") };
  }).filter((g) => g.acts.total + g.rules.total > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--rule)] pb-3">
        <div>
          <Breadcrumbs trail={[{ label: "Acts & Rules" }]} />
          <h1 className="page-title">Acts, Rules, Regulations and Master Directions</h1>
          <p className="meta mt-1">
            Every instrument has its own page — what it is, who issued it, and what has amended it.
          </p>
        </div>
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
            // Filters this page rather than searching the site, so no suggestion list -- but the browser's
            // own history of every "q" field ever typed is not wanted here either.
            autoComplete="off"
          />
          <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]">
            <input type="checkbox" name="seeded" value="1" defaultChecked={sp.seeded === "1"} /> only with text
          </label>
          {/* Only offered when there is something to show. A permanently unticked box for a set that is
              usually empty is a question nobody asked. */}
          {(supersededCount > 0 || showSuperseded) && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-2)]">
              <input type="checkbox" name="superseded" value="1" defaultChecked={showSuperseded} /> include
              superseded
            </label>
          )}
          <button className="btn">Filter</button>
          {(sp.q || sp.regulator || sp.seeded || sp.superseded) && (
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
        <section key={g.subject.key} className={`panel sub-rule reveal lift ${subjectClass(g.subject.key)}`}>
          <div className="panel-head">
            <h2 className="card-title">{g.subject.name}</h2>
            <span className="meta num ml-auto">
              {g.acts.total + g.rules.total === g.total ? n(g.total) : `${n(g.acts.items.length + g.rules.items.length)} of ${n(g.total)}`}{" "}
              instruments
            </span>
          </div>
          <div className="px-5 py-1">
            {(["acts", "rules"] as const).map((which) =>
              g[which].total === 0 ? null : (
                <div key={which} className="py-1.5">
                  <h3 className="eyebrow border-b border-[var(--rule)] pb-1">
                    {GROUP_HEADING[which]}
                    <span className="meta num ml-2 font-normal">{n(g[which].total)}</span>
                  </h3>
                  <ul>
                    {g[which].items.map((i) => (
                      <li key={i.id} className="border-b border-[var(--rule)] py-2.5 last:border-b-0">
                        <Link href={`/browse/${i.slug}`} className="text-[14px] hover:underline">
                          {i.title}
                        </Link>
                        {supersededBy(i.slug) && (
                          <span className="badge badge-neutral ml-2">
                            superseded
                          </span>
                        )}
                        <p className="meta mt-0.5">
                          {KIND_LABEL[i.kind] ?? i.kind} · {REGULATOR_LABEL[i.regulator_code] ?? i.regulator_code}
                          {i.official_updated_as_on && <> · text as on {fmtDate(i.official_updated_as_on)}</>}
                          {i.pdf_only ? (
                            <> · served as the official PDF{i.page_count ? `, ${n(i.page_count)} pages` : ""}</>
                          ) : i.provision_count ? (
                            <>
                              {" · "}
                              {n(i.provision_count)} {unitPlural(i.kind)}
                            </>
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
                    {g[which].items.length < g[which].total && (
                      <li className="py-2.5">
                        <Link
                          href={`/browse?subject=${g.subject.key}`}
                          className="text-[13px] text-[var(--link)] hover:underline"
                        >
                          Show all {n(g[which].total)} {GROUP_HEADING[which].toLowerCase()} in {g.subject.name} &rarr;
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              ),
            )}
          </div>
        </section>
      ))}

      {instruments.length === 0 && (
        <p className="panel border-dashed p-8 text-center text-[var(--ink-3)]">Nothing matches that filter.</p>
      )}
    </div>
  );
}
