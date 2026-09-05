import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { fmtDate, fmtDateTime, slugifyNumber } from "@/lib/format";
import { getInstrument, listProvisions, provisionHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-4">
      <div className="text-xs text-stone-500">
        <Link href="/browse" className="hover:underline">Regulations</Link> /{" "}
        <Link href={`/browse/${slug}`} className="hover:underline">{inst.title}</Link> /{" "}
        <Link href={`/browse/${slug}?p=${encodeURIComponent(provision.number)}`} className="hover:underline">{provision.number}</Link>
      </div>
      <h1 className="text-xl font-semibold">
        History of {provision.number} {provision.heading && <span className="text-stone-600">&middot; {provision.heading}</span>}
      </h1>
      <p className="text-sm text-stone-600">{versions.length} version{versions.length === 1 ? "" : "s"}, oldest first. Each change is shown against the version before it.</p>

      <ol className="space-y-6">
        {versions.map((v, idx) => {
          const prev = idx > 0 ? versions[idx - 1] : null;
          return (
            <li key={v.id} className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">Version {idx + 1}</span>
                <Badge kind={v.source_kind} />
                {v.verification_status && v.verification_status !== "unchecked" && <Badge kind={v.verification_status} />}
                <span className="text-stone-500">
                  {v.effective_from ? `in force from ${fmtDate(v.effective_from)}` : "effective date not stated"}
                  {v.effective_to ? ` to ${fmtDate(v.effective_to)}` : " (current)"}
                </span>
                {v.merge_confidence != null && <span className="text-stone-400">confidence {(v.merge_confidence * 100).toFixed(0)}%</span>}
                <span className="ml-auto text-stone-400">recorded {fmtDateTime(v.created_at)}</span>
              </div>
              {v.document_id && (
                <p className="mb-2 text-sm">
                  Source:{" "}
                  <Link href={`/documents/${v.document_id}`} className="text-sky-700 hover:underline">
                    {v.document_number ? `${v.document_number} - ` : ""}{v.document_title}
                  </Link>
                </p>
              )}
              {prev ? <Diff before={prev.text} after={v.text} /> : <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{v.text}</pre>}
              {v.footnote && <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">{v.footnote}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
