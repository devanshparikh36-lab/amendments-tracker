import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { qualityFlags, searchesWithNoResults } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

/* Provisions whose stored text does not look like a provision.
 *
 * There is one incident behind this page. The FEMA Act was seeded from India Code's text bundle, reported
 * as a success on the strength of "parses into 150 provisions", and published -- with section 3 holding a
 * footnote about section 18, and other sections holding lines from the arrangement-of-sections list.
 * Nothing in the pipeline ever looked at what was *in* a provision, only at how many there were. So a count
 * was checked where content should have been.
 *
 * This is that missing check, standing where someone can read it. It is not an error log: every row here is
 * a judgement for a person, because "this is a row of a tariff schedule, not a provision" is not something
 * a rule can conclude on its own. The flags narrow 5,120 provisions down to about 260 worth a look.
 *
 * No accept or reject yet, deliberately. Marking a row reviewed is a write, and a write needs to know who
 * is writing -- so it waits for sign-in rather than being bolted on as an unauthenticated button on a
 * public site.
 */

export const dynamic = "force-dynamic";

type Search = Promise<{ flag?: string; instrument?: string }>;

export const metadata = { title: "Text that needs a look" };

export default async function QualityPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const [{ rows, byFlag, byInstrument }, missing] = await Promise.all([
    qualityFlags({ flag: sp.flag, instrument: sp.instrument }),
    searchesWithNoResults(),
  ]);
  const total = byFlag.reduce((n, f) => n + f.n, 0);
  const chip = (href: string, label: string, on: boolean, n?: number) => (
    <Link key={label} href={href} className={`chip ${on ? "chip-on" : ""}`}>
      {label}
      {n === undefined ? "" : ` (${n})`}
    </Link>
  );

  return (
    <div className="mx-auto max-w-[76rem] space-y-5">
      <div>
        <Breadcrumbs trail={[{ label: "Collection status", href: "/status" }, { label: "Text that needs a look" }]} />
        <h1 className="page-title mt-1">Text that needs a look</h1>
        <p className="meta mt-1 max-w-3xl">
          {total.toLocaleString("en-IN")} of the provisions held carry text that does not read like a
          provision &mdash; a row of a schedule, a heading whose body never arrived, or the same words under
          two numbers. Each is a judgement for a person rather than a fault a rule can settle, so this is a
          list to read, not an error log. The checks live in one place, which is also what{" "}
          <code className="text-[12px]">cli.py quality</code> reads.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chip("/quality", "All", !sp.flag && !sp.instrument)}
        {byFlag.map((f) => chip(`/quality?flag=${f.flag}`, f.flag.replace(/_/g, " "), sp.flag === f.flag, f.n))}
      </div>

      {sp.flag && (
        <p className="text-[13px] text-[var(--ink-2)]">{byFlag.find((f) => f.flag === sp.flag)?.detail}</p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">
            {rows.length.toLocaleString("en-IN")} shown
            {sp.instrument ? ` in ${sp.instrument}` : ""}
          </h2>
        </div>
        <div className="scroll-x">
          <table className="dtable">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Number</th>
                <th>Flag</th>
                <th>What is held</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.provision_id}-${r.flag}`}>
                  <td className="whitespace-nowrap text-[12.5px]">
                    <Link href={`/quality?instrument=${r.instrument_slug}`} className="hover:underline">
                      {r.instrument_slug}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap">
                    {/* Straight to the provision as a reader sees it, which is the only way to judge it. */}
                    <Link
                      href={`/browse/${r.instrument_slug}/text?p=${encodeURIComponent(r.number)}`}
                      className="text-[var(--link)] hover:underline"
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-[var(--ink-3)]">{r.flag.replace(/_/g, " ")}</td>
                  <td className="text-[12.5px]">{r.sample}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-[13px] text-[var(--ink-3)]">
                    Nothing flagged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* The other direction of the same question. Everything above measures what we hold against what it
          ought to look like; this measures it against what people came here for and did not get. One is
          our opinion of the library, the other is its readers'. */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">Looked for, not found ({missing.length})</h2>
          <p className="meta mt-0.5 max-w-3xl">
            Searches from the last 90 days that returned nothing, most asked first. The wording of searches
            that <em>succeeded</em> is deliberately not kept &mdash; in this practice a query can name a
            live matter, and a search the library answered has already told us what we needed.
          </p>
        </div>
        {missing.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-[var(--ink-3)]">
            Nothing recorded yet. This fills in as the site is used.
          </p>
        ) : (
          <div className="scroll-x">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Searched for</th>
                  <th className="text-right">Times</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((m) => (
                  <tr key={m.query_key}>
                    <td>
                      <Link href={`/find?q=${encodeURIComponent(m.query)}&all=1`} className="hover:underline">
                        {m.query}
                      </Link>
                    </td>
                    <td className="num text-right">{m.times}</td>
                    <td className="num text-[12px] text-[var(--ink-3)]">{fmtDate(m.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">Where they are</h2>
          <p className="meta mt-0.5">
            Concentrated rather than scattered, which is the useful part: these are a few parsers meeting a
            few document layouts, not a general problem with the library.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 px-5 py-3">
          {byInstrument.map((i) =>
            chip(`/quality?instrument=${i.instrument_slug}`, i.instrument_slug, sp.instrument === i.instrument_slug, i.n),
          )}
        </div>
      </section>
    </div>
  );
}
