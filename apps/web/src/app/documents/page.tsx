import Link from "next/link";
import { Badge } from "@/components/Badge";
import { DOC_TYPE_LABEL, fmtDate } from "@/lib/format";
import { listDocuments, listInstruments } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Search = Promise<{ regulator?: string; type?: string; instrument?: string; q?: string; from?: string; to?: string; page?: string }>;

export default async function DocumentsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const limit = 100;
  const [docs, instruments] = await Promise.all([
    listDocuments({ regulator: sp.regulator, docType: sp.type, instrument: sp.instrument, q: sp.q, from: sp.from, to: sp.to, limit, offset: (page - 1) * limit }),
    listInstruments(),
  ]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Documents</h1>
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
        <label className="flex flex-col text-xs text-stone-500">Regulator
          <select name="regulator" defaultValue={sp.regulator ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {["RBI", "DEA", "CBDT", "CBIC", "MCA", "SEBI"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-stone-500">Type
          <select name="type" defaultValue={sp.type ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-stone-500">Regulation
          <select name="instrument" defaultValue={sp.instrument ?? ""} className="max-w-xs rounded border border-stone-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {instruments.map((i) => <option key={i.slug} value={i.slug}>{i.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-stone-500">From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-stone-500">To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-stone-500">Title / number
          <input name="q" defaultValue={sp.q ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm" />
        </label>
        <button className="rounded bg-stone-800 px-3 py-1.5 text-white">Filter</button>
        <a href={`/api/export/documents?${qs.toString()}`} className="ml-auto text-sky-700 hover:underline">Export CSV</a>
      </form>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Regulator</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Affects</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-t border-stone-100 align-top hover:bg-stone-50">
                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDate(d.date_issued)}</td>
                <td className="px-3 py-2 text-stone-600">{d.regulator_code}</td>
                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</td>
                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{d.number}</td>
                <td className="px-3 py-2"><Link href={`/documents/${d.id}`} className="hover:underline">{d.title}</Link></td>
                <td className="px-3 py-2 text-stone-600">{d.affects ?? (d.is_amending === false ? <span className="text-stone-400">not amending</span> : "")}</td>
                <td className="px-3 py-2"><Badge kind={d.tag_status} /></td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-500">No documents match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/documents?${qs}&page=${page - 1}`} className="hover:underline">&larr; Previous</Link> : <span />}
        {docs.length === limit && <Link href={`/documents?${qs}&page=${page + 1}`} className="hover:underline">Next &rarr;</Link>}
      </div>
    </div>
  );
}
