import Link from "next/link";
import { Breadcrumbs } from "@/components/PageHeader";
import { Badge } from "@/components/Badge";
import { authorised } from "@/lib/admin";
import { fmtDate, fmtDateTime, provisionHref } from "@/lib/format";
import { jobStats, pageViews, recentEffects, sourceGaps, sourceRuns } from "@/lib/queries";

/* Behind the admin key since 15 October 2026.
 *
 * It was public, deliberately and with a stated rationale -- anyone could audit how current the library
 * was and what had failed, which is a good thing for a site asking to be trusted about the law. That was
 * reversed on the owner's instruction, and the honest reason to record is that it is now an operational
 * console rather than a public report: it carries run timings, job backlogs, failed fetches and per-page
 * view counts, which answer "how is my pipeline" and not "can I rely on this provision".
 *
 * What a reader loses is the self-reporting the terms used to point at, so that clause was rewritten in
 * the same change rather than left pointing at a door that no longer opens. The freshness signal readers
 * actually used -- "Last checked <time>" in the masthead -- stays, as text rather than a link.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Collection status", robots: { index: false, follow: false } };

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  if (!authorised(key)) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="panel panel-body">
          <p className="eyebrow">Collection status</p>
          <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Not available</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            This page is part of the admin console. If you are the owner, append{" "}
            <code className="num">?key=</code> and the value of <code className="num">ADMIN_KEY</code>.
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            Every page carries the time collection last ran in the masthead, and each provision links to the
            regulator&rsquo;s own document &mdash; which is the authority either way.
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

  const [runs, jobs, effects, gaps, views] = await Promise.all([
    sourceRuns(),
    jobStats(),
    recentEffects(100),
    sourceGaps(),
    pageViews(30),
  ]);
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
        <Breadcrumbs trail={[{ label: "Collection status" }]} />
        <h1 className="page-title mt-1">Collection status</h1>
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

      {/* The other half of "is this collection any good": the jobs table says whether collection ran, and
          says nothing about whether what it collected reads like law. That distinction is the whole reason
          150 wrong FEMA provisions were published on a green run. */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="eyebrow">Text that needs a look</h2>
          <p className="meta mt-0.5 max-w-3xl">
            Provisions whose stored text does not read like a provision &mdash; a row of a schedule, a
            heading whose body never arrived, the same words under two numbers.{" "}
            <Link href="/quality" className="text-[var(--link)] hover:underline">
              Review them
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Stated here rather than left as permanent failures in the table above. These are documents the
          regulator has not published; nothing in the pipeline can produce them, and a backlog that cannot
          be cleared is one people stop reading. */}
      {gaps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">Published by nobody ({gaps.length})</h2>
            <p className="meta mt-0.5 max-w-3xl">
              The regulator&rsquo;s own page for these carries no text to collect &mdash; in each case a
              covering circular with no consolidated document attached. Re-checked on the usual schedule, so
              this clears itself if the document ever appears.
            </p>
          </div>
          <div className="scroll-x">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Regulator</th>
                  <th>Confirmed</th>
                  <th>Regulator&rsquo;s page</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.slug}>
                    <td>
                      <Link href={`/browse/${g.slug}`} className="hover:underline">
                        {g.title}
                      </Link>
                    </td>
                    <td>{g.regulator_code}</td>
                    <td className="num">{fmtDate(g.source_state_at)}</td>
                    <td className="text-[12px]">
                      {g.official_url && (
                        <a href={g.official_url} target="_blank" rel="noreferrer" className="text-[var(--link)] hover:underline">
                          open
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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

      {/* What is being read.
          
          Here rather than on a page of its own, and here rather than public: this is a maintenance screen,
          robots.txt disallows it, and these numbers are about the site rather than about the law. They are
          views and never visitors -- nothing identifying is recorded, so "how many people" is a question
          this cannot answer and was built not to. */}
      <section>
        <div className="panel">
          <div className="panel-head flex flex-wrap items-center gap-2">
            <h2 className="eyebrow">Read in the last {views.days} days</h2>
            <span className="meta num ml-auto">{views.total.toLocaleString("en-IN")} views</span>
          </div>
          {views.total === 0 ? (
            <p className="p-6 text-center text-[13px] text-[var(--ink-3)]">
              Nothing counted yet. The counter starts with the next deploy.
            </p>
          ) : (
            <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-[var(--rule)]">
              <div className="p-3">
                <h3 className="eyebrow mb-1.5">By page</h3>
                <table className="dtable">
                  <tbody>
                    {views.byPath.map((r) => (
                      <tr key={r.path}>
                        <td className="num">{r.path}</td>
                        <td className="num text-right">{r.views.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3">
                <h3 className="eyebrow mb-1.5">Most-read instruments</h3>
                {views.byInstrument.length === 0 ? (
                  <p className="meta">None yet.</p>
                ) : (
                  <table className="dtable">
                    <tbody>
                      {views.byInstrument.map((r) => (
                        <tr key={r.slug}>
                          <td>
                            <Link href={`/browse/${r.slug}`} className="hover:underline">
                              {r.title ?? r.slug}
                            </Link>
                          </td>
                          <td className="num text-right">{r.views.toLocaleString("en-IN")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
