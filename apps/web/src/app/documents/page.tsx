import Link from "next/link";
import { Badge } from "@/components/Badge";
import { OfficialNumber } from "@/components/OfficialNumber";
import {SUBJECTS } from "@/lib/catalogue";
import { DOC_TYPE_LABEL, fmtDate } from "@/lib/format";
import { instrumentIndex, listDocuments } from "@/lib/queries";

// Dynamic because it reads searchParams, which is the honest reason -- not because a blanket setting in the
// root layout said so. Next works that out for itself.

export const metadata = { title: "Notifications and circulars" };

type Search = Promise<{
  subject?: string;
  regulator?: string;
  type?: string;
  instrument?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string;
}>;

/* The parts of the current filter a subscription can honour.
 *
 * Only regulator and instrument. A feed is a standing question -- "what is new here" -- and the other
 * filters answer different kinds of question: a date range would go quiet the moment it fell behind the
 * present, and a title search would turn a subscription into a saved query whose results nobody revisits.
 * Those belong in the CSV export beside it, which is a snapshot and is meant to be.
 */
function feedQuery(sp: { regulator?: string; instrument?: string }): string {
  const p = new URLSearchParams();
  if (sp.regulator) p.set("regulator", sp.regulator);
  if (sp.instrument) p.set("instrument", sp.instrument);
  return p.toString();
}


export default async function DocumentsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  // 100 rows cost 677 KB, because a server component ships its rendered tree twice: once as HTML and once as
  // the flight payload it is escaped into. 40 is still a long page to scroll on a phone, and the pager below
  // reaches the rest.
  const limit = 40;
  const [docs, instruments] = await Promise.all([
    listDocuments({
      regulator: sp.regulator,
      regulators: sp.subject ? SUBJECTS.find((s) => s.key === sp.subject)?.regulators : undefined,
      docType: sp.type,
      instrument: sp.instrument,
      q: sp.q,
      from: sp.from,
      to: sp.to,
      limit,
      offset: (page - 1) * limit,
    }),
    instrumentIndex(),
  ]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  // ?regulator= is still honoured: it is what the instrument pages and "what's new" links already point at,
  // and old links should not break because the control above changed vocabulary.
  const subject =
    SUBJECTS.find((s) => s.key === sp.subject) ??
    SUBJECTS.find((s) => sp.regulator && s.regulators.includes(sp.regulator));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--rule)] pb-3">
        <div>
          <h1 className="page-title">
            {subject ? `${subject.name} — notifications and circulars` : "Notifications, circulars and gazette copies"}
          </h1>
          <p className="meta mt-1">
            As collected from the regulator&rsquo;s own site. Each entry links to the official source and to the
            instruments it was tagged against.
          </p>
        </div>
        <p className="meta num">
          showing {docs.length.toLocaleString("en-IN")}
          {page > 1 ? ` (page ${page})` : ""}
        </p>
      </div>

      {/* The same control, with the same vocabulary, as /browse. This page used to offer regulators here
          and the identical choice again as a dropdown in the form below -- the same filter twice, in two
          different idioms, on one page. Subjects are what a reader thinks in; the regulator is still shown
          on every row. */}
      <div className="no-print flex flex-wrap items-center gap-1.5">
        <Link href="/documents" className={`chip ${!sp.subject ? "chip-on" : ""}`}>
          All subjects
        </Link>
        {SUBJECTS.map((s) => (
          <Link
            key={s.key}
            href={`/documents?subject=${s.key}`}
            className={`chip ${sp.subject === s.key ? "chip-on" : ""}`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      <form className="no-print panel flex flex-wrap items-end gap-3 p-3">
        {/* The regulator dropdown that stood here has gone: the chips above are the same filter, and having
            both meant two controls for one choice that could disagree with each other. The form keeps the
            dimensions chips cannot carry -- a type, one of 195 instruments, a date range, a phrase. */}
        {sp.subject && <input type="hidden" name="subject" value={sp.subject} />}
        {sp.regulator && <input type="hidden" name="regulator" value={sp.regulator} />}
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Type
          <select name="type" defaultValue={sp.type ?? ""} className="field mt-0.5">
            <option value="">All</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Regulation
          <select name="instrument" defaultValue={sp.instrument ?? ""} className="field mt-0.5 max-w-xs">
            <option value="">All</option>
            {instruments.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="field mt-0.5" />
        </label>
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="field mt-0.5" />
        </label>
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Title or number
          <input name="q" defaultValue={sp.q ?? ""} className="field mt-0.5" autoComplete="off" />
        </label>
        <button className="btn btn-primary">Filter</button>
        <a href={`/api/export/documents?${qs.toString()}`} className="ml-auto text-[13px] text-[var(--link)] hover:underline">
          Export CSV
        </a>
        {/* The feed carries the filter you are looking at, so "subscribe" means this list and not a
            different one. Only regulator and instrument are passed on: the feed answers "what is new",
            and a date range in a subscription would quietly stop producing anything. */}
        <a
          href={`/feed.xml${feedQuery(sp) ? `?${feedQuery(sp)}` : ""}`}
          className="text-[13px] text-[var(--link)] hover:underline"
          title="An Atom feed Outlook, Teams or any feed reader can follow"
        >
          Subscribe
        </a>
      </form>

      <div className="panel scroll-x">
        <table className="dtable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Regulator</th>
              <th>Type</th>
              {/* Title before number: the title says what the notification is, and is what a reader scans
                  for. The number is the citation you carry away afterwards. */}
              <th>Title</th>
              <th>Number &amp; official file</th>
              <th>Affects</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="num whitespace-nowrap text-[var(--ink-2)]">{fmtDate(d.date_issued)}</td>
                <td className="text-[var(--ink-2)]">{d.regulator_code}</td>
                <td className="whitespace-nowrap text-[var(--ink-2)]">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</td>
                <td>
                  <Link href={`/documents/${d.id}`} className="hover:underline">
                    {d.title}
                  </Link>
                </td>
                {/* No whitespace-nowrap: SEBI numbers are long enough to push the table sideways, and the
                    chip wraps its own text instead. */}
                <td className="align-top text-[var(--ink-2)]">
                  <OfficialNumber doc={d} number={d.number} />
                </td>
                <td className="text-[var(--ink-2)]">
                  {d.affects ?? (d.is_amending === false ? <span className="text-[var(--ink-4)]">not amending</span> : "")}
                </td>
                <td>
                  <Badge kind={d.tag_status} />
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--ink-3)]">
                  No documents match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="no-print flex justify-between text-[13px]">
        {page > 1 ? (
          <Link href={`/documents?${qs}&page=${page - 1}`} className="btn">
            &larr; Previous
          </Link>
        ) : (
          <span />
        )}
        {docs.length === limit && (
          <Link href={`/documents?${qs}&page=${page + 1}`} className="btn">
            Next &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
