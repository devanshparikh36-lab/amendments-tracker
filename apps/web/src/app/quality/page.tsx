import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { authorised } from "@/lib/admin";
import { qualityFlags } from "@/lib/queries";

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

/* Behind the admin key, like /status, and for the same reason.
 *
 * This lists provisions whose stored text does not read like a clean extraction -- truncations, OCR
 * damage, a heading with no body. That is a worklist for whoever maintains the corpus, not a report for
 * a reader, and published openly it is a map of exactly where this library is weakest. A reader is better
 * served by the link to the regulator's own document that every provision already carries.
 *
 * Gated a day after /status, which was gated alone because that was what was asked for. Leaving its
 * sibling open was never a decision, only an omission.
 */
export const dynamic = "force-dynamic";

type Search = Promise<{ flag?: string; instrument?: string; key?: string }>;

export const metadata = { title: "Text that needs a look", robots: { index: false, follow: false } };

export default async function QualityPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  if (!authorised(sp.key)) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="panel panel-body">
          <p className="eyebrow">Text that needs a look</p>
          <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Not available</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            This page is part of the admin console. If you are the owner, append{" "}
            <code className="num">?key=</code> and the value of <code className="num">ADMIN_KEY</code>.
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            Every provision links to the regulator&rsquo;s own document, which is the authority if anything
            here reads oddly.
          </p>
          <p className="mt-3 text-[13px]">
            <Link href="/" className="text-[var(--link)] hover:underline">
              Go to the site &rarr;
            </Link>
          </p>
        </div>
      </div>
    );
  }
  /* Every link from this page back to itself has to carry the key.
   *
   * Without this the first filter press drops it and the page locks the owner out of its own filters --
   * the sort of gate that looks like it works until somebody uses it. `mine` takes the path and whatever
   * query it already has, and appends the key with the right separator. */
  const mine = (href: string) =>
    `${href}${href.includes("?") ? "&" : "?"}key=${encodeURIComponent(sp.key ?? "")}`;

  const { rows, byFlag, byInstrument } = await qualityFlags({ flag: sp.flag, instrument: sp.instrument });
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
        {/* Climbs to Home rather than to Collection status, which moved behind the admin key. A
            breadcrumb to a page the reader cannot open is a worse trail than a shorter one. */}
        <Breadcrumbs trail={[{ label: "Home", href: "/" }, { label: "Text that needs a look" }]} />
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
        {chip(mine("/quality"), "All", !sp.flag && !sp.instrument)}
        {byFlag.map((f) => chip(mine(`/quality?flag=${f.flag}`), f.flag.replace(/_/g, " "), sp.flag === f.flag, f.n))}
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
                    <Link href={mine(`/quality?instrument=${r.instrument_slug}`)} className="hover:underline">
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

      {/* The failed-search list is deliberately NOT shown here.
          
          It belongs on this page by subject -- it is the other half of "is what we hold any good", measured
          by readers rather than by us. But this site has no sign-in, so this page is public, and the one
          thing that list contains is text someone typed. By design the wording is kept only for searches
          that found nothing, and those are precisely the ones carrying unusual terms: in a tax practice,
          "section 68 cash credits <client>" is a plausible query and publishing it would be a disclosure.
          
          So it is collected and read through `cli.py quality`, which runs where the database credentials
          already are. The alternative -- not recording the text at all -- would throw away the only measure
          of coverage that comes from the people using the site.

          Note for whoever picks this up: the gate this was waiting for now exists. /admin is behind
          ADMIN_KEY, so the list could live there. The reader accounts added on 14 October are NOT that gate
          and must never be mistaken for one -- an unverified email address authenticates nobody, which is
          the whole premise of that feature and the reason this list cannot sit behind it. */}

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
            chip(mine(`/quality?instrument=${i.instrument_slug}`), i.instrument_slug, sp.instrument === i.instrument_slug, i.n),
          )}
        </div>
      </section>
    </div>
  );
}
