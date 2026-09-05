import Link from "next/link";
import { Badge } from "@/components/Badge";
import { DOC_TYPE_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import { homeStats, listDocuments, recentEffects } from "@/lib/queries";

export const dynamic = "force-dynamic";

function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: string }) {
  const body = (
    <div className={`rounded-lg border bg-white p-4 ${tone ?? "border-stone-200"}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function Home() {
  const [stats, docs, effects] = await Promise.all([homeStats(), listDocuments({ limit: 40 }), recentEffects(20)]);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-1 text-xl font-semibold">What&rsquo;s new</h1>
        <p className="mb-4 text-sm text-stone-600">
          Last source check: {stats.last_run ? fmtDateTime(stats.last_run) : "never"}
          {stats.pending > 0 && <> &middot; {stats.pending} jobs in progress</>}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Documents" value={stats.documents} href="/documents" />
          <Stat label="Regulations tracked" value={stats.instruments} href="/browse" />
          <Stat label="Provisions" value={stats.provisions} />
          <Stat label="Machine-consolidated provisions" value={stats.machine_versions} tone="border-amber-200" />
          <Stat label="Amendments not applied automatically" value={stats.cannot_apply} tone={stats.cannot_apply ? "border-red-300" : "border-stone-200"} href="/status" />
          <Stat label="Differ from official republication" value={stats.differs} tone={stats.differs ? "border-red-300" : "border-stone-200"} href="/status" />
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Latest documents</h2>
            <Link href="/documents" className="text-sm text-stone-600 hover:underline">All documents</Link>
          </div>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Affects</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-stone-100 align-top hover:bg-stone-50">
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDate(d.date_issued)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{d.number}</td>
                    <td className="px-3 py-2">
                      <Link href={`/documents/${d.id}`} className="hover:underline">{d.title}</Link>
                    </td>
                    <td className="px-3 py-2 text-stone-600">
                      {d.affects ?? (d.is_amending === false ? <span className="text-stone-400">not amending</span> : <Badge kind={d.tag_status} />)}
                    </td>
                  </tr>
                ))}
                {docs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-500">No documents yet. Run the worker.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Latest consolidation changes</h2>
          <ul className="space-y-2">
            {effects.map((e) => (
              <li key={e.id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge kind={e.change_type} />
                  <Badge kind={e.verification_status} />
                </div>
                <div className="mt-1">
                  <Link href={`/browse/${e.instrument_slug}?p=${encodeURIComponent(e.provision_number)}`} className="font-medium hover:underline">
                    {e.instrument_title} &middot; {e.provision_number}
                  </Link>
                </div>
                <div className="text-xs text-stone-600">
                  by <Link href={`/documents/${e.document_id}`} className="hover:underline">{e.document_title}</Link>
                </div>
              </li>
            ))}
            {effects.length === 0 && <li className="text-sm text-stone-500">No machine merges yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
