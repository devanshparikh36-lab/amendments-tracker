import Link from "next/link";
import { Badge } from "@/components/Badge";
import { fmtDateTime } from "@/lib/format";
import { provisionHref } from "@/lib/lookup";
import { jobStats, recentEffects, sourceRuns } from "@/lib/queries";

// Deliberately dynamic: this page answers "is collection alive right now", and a cached answer to that
// question is worse than a slow one.
export const dynamic = "force-dynamic";

export const metadata = { title: "Collection status" };

export default async function StatusPage() {
  const [runs, jobs, effects] = await Promise.all([sourceRuns(), jobStats(), recentEffects(100)]);
  const problems = effects.filter(
    (e) => e.change_type === "cannot_apply" || e.verification_status === "differs_from_official",
  );

  // A job that has exhausted its three attempts is never retried by anything. It is therefore the one thing
  // on this page that genuinely needs a person, and it was the one thing this page would not admit to: the
  // panel below counted only amendment effects, so it printed "Nothing outstanding" above a table showing
  // 397 failed self-checks and 6 failed fetches. The whole point of the page is to answer "what should I
  // look at", and it was answering "nothing" while the answer was 403.
  const failed = jobs.filter((j) => j.status === "failed" && j.n > 0);
  const failedTotal = failed.reduce((n, j) => n + j.n, 0);
  const attention = problems.length + failedTotal;

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--rule)] pb-3">
        <h1 className="page-title">Collection status</h1>
        <p className="meta mt-1">What the collector last ran, what it queued, and what a person should look at.</p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">Source runs</h2>
        </div>
        <div className="scroll-x">
          <table className="dtable">
            <thead>
              <tr>
                <th>Adapter</th>
                <th>Started</th>
                <th>Finished</th>
                <th className="text-right">Found</th>
                <th className="text-right">New</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.adapter}</td>
                  <td className="num whitespace-nowrap text-[var(--ink-2)]">{fmtDateTime(r.started_at)}</td>
                  <td className="num whitespace-nowrap text-[var(--ink-2)]">{fmtDateTime(r.finished_at)}</td>
                  <td className="num text-right">{r.docs_found}</td>
                  <td className="num text-right">{r.docs_new}</td>
                  <td>
                    {r.ok === null ? (
                      <Badge kind="pending">running</Badge>
                    ) : r.ok ? (
                      <Badge kind="merged">ok</Badge>
                    ) : (
                      <span title={r.error ?? ""}>
                        <Badge kind="failed">failed</Badge>{" "}
                        <span className="text-[12px] text-[var(--flag-alert)]">{r.error?.split("\n")[0]}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">Jobs</h2>
        </div>
        <div className="scroll-x">
          <table className="dtable">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th className="text-right">Count</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={i}>
                  <td>{j.type}</td>
                  <td>
                    <Badge kind={j.status === "done" ? "merged" : j.status === "failed" ? "failed" : "pending"}>
                      {j.status}
                    </Badge>
                  </td>
                  <td className="num text-right">{j.n}</td>
                  <td className="text-[12px] text-[var(--flag-alert)]">{j.status === "failed" ? j.last_error : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2">
          <h2 className="section-title">Needs attention ({attention})</h2>
          <p className="meta mt-0.5 max-w-3xl">
            Jobs that have given up after three attempts and will not be retried by anything, plus amendments the
            merge engine could not apply unambiguously. In every case the official text is what the reader is
            shown &mdash; nothing here changes a provision, it only means something was not collected.
          </p>
        </div>
        <ul className="space-y-2">
          {failed.map((j) => (
            <li key={`${j.type}-${j.status}`} className="panel panel-body">
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind="failed">{j.n.toLocaleString("en-IN")} failed</Badge>
                <span className="num font-medium">{j.type}</span>
                <span className="meta ml-auto">no further retries</span>
              </div>
              {j.last_error && (
                <p className="mt-1 break-words text-[12.5px] text-[var(--ink-2)]">{j.last_error}</p>
              )}
            </li>
          ))}
          {problems.map((e) => (
            <li key={e.id} className="panel panel-body">
              <div className="flex flex-wrap items-center gap-2">
                <Badge kind={e.change_type} />
                <Badge kind={e.verification_status} />
                <span className="meta num ml-auto">{fmtDateTime(e.created_at)}</span>
              </div>
              <Link href={provisionHref(e.instrument_slug, e.provision_number)} className="font-medium hover:underline">
                {e.instrument_title} &middot; {e.provision_number}
              </Link>
              <div className="meta">
                from{" "}
                <Link href={`/documents/${e.document_id}`} className="hover:underline">
                  {e.document_title}
                </Link>
              </div>
              {e.ai_note && <p className="mt-1 text-[12.5px] text-[var(--ink-2)]">{e.ai_note}</p>}
            </li>
          ))}
          {attention === 0 && (
            <li className="panel border-dashed p-6 text-center text-[var(--ink-3)]">Nothing outstanding.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
