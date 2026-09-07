import Link from "next/link";
import { Badge } from "@/components/Badge";
import { REGULATOR_LABEL, SUBJECTS } from "@/lib/catalogue";
import { DOC_TYPE_LABEL, fmtDate } from "@/lib/format";
import { instrumentIndex, listDocuments } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Notifications and circulars" };

type Search = Promise<{
  regulator?: string;
  type?: string;
  instrument?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string;
}>;

const REGULATORS = ["CBDT", "CBIC", "RBI", "DEA", "SEBI", "MCA"];

export default async function DocumentsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const limit = 100;
  const [docs, instruments] = await Promise.all([
    listDocuments({
      regulator: sp.regulator,
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
  const subject = SUBJECTS.find((s) => sp.regulator && s.regulators.includes(sp.regulator));

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

      <div className="no-print flex flex-wrap items-center gap-1.5">
        <Link href="/documents" className={`chip ${!sp.regulator ? "chip-on" : ""}`}>
          All regulators
        </Link>
        {REGULATORS.map((r) => (
          <Link key={r} href={`/documents?regulator=${r}`} className={`chip ${sp.regulator === r ? "chip-on" : ""}`}>
            {REGULATOR_LABEL[r] ?? r}
          </Link>
        ))}
      </div>

      <form className="no-print panel flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col text-[11.5px] text-[var(--ink-3)]">
          Regulator
          <select name="regulator" defaultValue={sp.regulator ?? ""} className="field mt-0.5">
            <option value="">All</option>
            {REGULATORS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
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
          <input name="q" defaultValue={sp.q ?? ""} className="field mt-0.5" />
        </label>
        <button className="btn btn-primary">Filter</button>
        <a href={`/api/export/documents?${qs.toString()}`} className="ml-auto text-[13px] text-[var(--link)] hover:underline">
          Export CSV
        </a>
      </form>

      <div className="panel scroll-x">
        <table className="dtable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Regulator</th>
              <th>Type</th>
              <th>Number</th>
              <th>Title</th>
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
                <td className="whitespace-nowrap text-[var(--ink-2)]">{d.number}</td>
                <td>
                  <Link href={`/documents/${d.id}`} className="hover:underline">
                    {d.title}
                  </Link>
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
