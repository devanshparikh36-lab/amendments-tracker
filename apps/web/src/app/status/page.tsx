import Link from "next/link";
import { Badge } from "@/components/Badge";
import { fmtDateTime } from "@/lib/format";
import { jobStats, recentEffects, sourceRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [runs, jobs, effects] = await Promise.all([sourceRuns(), jobStats(), recentEffects(100)]);
  const problems = effects.filter((e) => e.change_type === "cannot_apply" || e.verification_status === "differs_from_official");
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Pipeline status</h1>

      <section>
        <h2 className="mb-2 font-semibold">Source runs</h2>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Adapter</th><th className="px-3 py-2">Started</th><th className="px-3 py-2">Finished</th><th className="px-3 py-2 text-right">Found</th><th className="px-3 py-2 text-right">New</th><th className="px-3 py-2">Result</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="px-3 py-2">{r.adapter}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDateTime(r.started_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDateTime(r.finished_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.docs_found}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.docs_new}</td>
                  <td className="px-3 py-2">{r.ok === null ? <Badge kind="pending">running</Badge> : r.ok ? <Badge kind="merged">ok</Badge> : <span title={r.error ?? ""}><Badge kind="failed">failed</Badge> <span className="text-xs text-red-700">{r.error?.split("\n")[0]}</span></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Jobs</h2>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Count</th><th className="px-3 py-2">Last error</th></tr></thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={i} className="border-t border-stone-100"><td className="px-3 py-2">{j.type}</td><td className="px-3 py-2"><Badge kind={j.status === "done" ? "merged" : j.status === "failed" ? "failed" : "pending"}>{j.status}</Badge></td><td className="px-3 py-2 text-right tabular-nums">{j.n}</td><td className="px-3 py-2 text-xs text-red-700">{j.status === "failed" ? j.last_error : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Needs attention ({problems.length})</h2>
        <p className="mb-2 text-sm text-stone-600">Amendments the merge engine could not apply unambiguously, and machine merges that the regulator&rsquo;s later republication contradicted. The official text is already live in both cases.</p>
        <ul className="space-y-2 text-sm">
          {problems.map((e) => (
            <li key={e.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2"><Badge kind={e.change_type} /><Badge kind={e.verification_status} /><span className="text-xs text-stone-400">{fmtDateTime(e.created_at)}</span></div>
              <Link href={`/browse/${e.instrument_slug}?p=${encodeURIComponent(e.provision_number)}`} className="font-medium hover:underline">{e.instrument_title} &middot; {e.provision_number}</Link>
              <div className="text-xs text-stone-600">from <Link href={`/documents/${e.document_id}`} className="hover:underline">{e.document_title}</Link></div>
              {e.ai_note && <p className="mt-1 text-xs text-stone-600">{e.ai_note}</p>}
            </li>
          ))}
          {problems.length === 0 && <li className="text-stone-500">Nothing outstanding.</li>}
        </ul>
      </section>
    </div>
  );
}
