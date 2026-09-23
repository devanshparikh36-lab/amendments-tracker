import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { OfficialNumber } from "@/components/OfficialNumber";
import { unitFor } from "@/lib/catalogue";
import { fmtDate, fmtDateTime, slugifyNumber } from "@/lib/format";
import { provisionHref } from "@/lib/lookup";
import { getInstrument, listProvisions, provisionHistory } from "@/lib/queries";

// An amendment history only changes when a new version of the provision is recorded, which happens during
// collection at 07:00 if at all. Rendered once and reused for an hour, rather than rebuilt for every reader.
export const revalidate = 3600;

/* Nothing is prerendered here, and the empty list is the point.
 *
 * A segment with parameters and no generateStaticParams at all is treated as fully dynamic: rendered per
 * request, with `no-store` on every response. Declaring the function -- even returning nothing from it --
 * puts the route on the static path instead, so each history is rendered once on first request and then
 * cached like any other page.
 *
 * Empty rather than populated because there are 5,882 provisions and no way to guess which handful anyone
 * will open. Building all of them would cost minutes on every deploy to prepare pages nobody asks for.
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export default async function HistoryPage({ params }: { params: Promise<{ slug: string; prov: string }> }) {
  const { slug, prov } = await params;
  const inst = await getInstrument(slug);
  if (!inst) notFound();
  // provision numbers are slugified in the URL; resolve back by matching slugified numbers
  const all = await listProvisions(inst.id);
  const match = all.find((p) => slugifyNumber(p.number) === prov);
  if (!match) notFound();
  const history = await provisionHistory(inst.id, match.number);
  if (!history) notFound();
  const { provision, versions } = history;
  const unit = unitFor(inst.kind);

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--rule)] pb-3">
        <p className="crumbs no-print">
          <Link href="/browse">Acts &amp; Rules</Link> / <Link href={`/browse/${slug}`}>{inst.title}</Link> /{" "}
          <Link href={provisionHref(slug, provision.number)}>{provision.number}</Link> / history
        </p>
        <h1 className="page-title mt-1 capitalize">
          {unit} {provision.number}
          {provision.heading && (
            <span className="serif font-normal text-[var(--ink-2)]"> &middot; {provision.heading}</span>
          )}
        </h1>
        <p className="meta mt-1">
          {versions.length} version{versions.length === 1 ? "" : "s"}, oldest first. Each change is shown against the
          version before it.
        </p>
      </div>

      <ol className="space-y-4">
        {versions.map((v, idx) => {
          const prev = idx > 0 ? versions[idx - 1] : null;
          return (
            <li key={v.id} className="panel panel-body">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-semibold">Version {idx + 1}</span>
                <Badge kind={v.source_kind} />
                {v.verification_status && v.verification_status !== "unchecked" && (
                  <Badge kind={v.verification_status} />
                )}
                <span className="num text-[var(--ink-3)]">
                  {v.effective_from ? `in force from ${fmtDate(v.effective_from)}` : "effective date not stated"}
                  {v.effective_to ? ` to ${fmtDate(v.effective_to)}` : " (current)"}
                </span>
                {v.merge_confidence != null && (
                  <span className="num text-[var(--ink-4)]">confidence {(v.merge_confidence * 100).toFixed(0)}%</span>
                )}
                <span className="num ml-auto text-[var(--ink-4)]">recorded {fmtDateTime(v.created_at)}</span>
              </div>
              {v.document_id && (
                <div className="mb-2 text-[13px]">
                  <span className="eyebrow">Source</span>
                  <p className="mt-0.5">
                    <Link
                      href={`/documents/${v.document_id}`}
                      className="font-medium text-[var(--link)] hover:underline"
                    >
                      {v.document_title}
                    </Link>
                  </p>
                  {v.document_number && (
                    <p className="mt-1">
                      <OfficialNumber doc={v} number={v.document_number} />
                    </p>
                  )}
                </div>
              )}
              {prev ? <Diff before={prev.text} after={v.text} /> : <div className="legal-pre">{v.text}</div>}
              {v.footnote && (
                <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[12px] text-[var(--ink-3)]">{v.footnote}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
