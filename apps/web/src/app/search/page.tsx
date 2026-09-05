import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { search } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const results = q?.trim() ? await search(q.trim()) : null;
  return (
    <div className="space-y-6">
      <form className="flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="e.g. all-in-cost ceiling, SNRR account, ECB liability" className="w-full rounded-md border border-stone-300 px-3 py-2" autoFocus />
        <button className="rounded-md bg-stone-800 px-4 py-2 text-white">Search</button>
      </form>
      {results && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section>
            <h2 className="mb-2 font-semibold">Consolidated text ({results.provisions.length})</h2>
            <ul className="space-y-2 text-sm">
              {results.provisions.map((r) => (
                <li key={r.provision_id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <Link href={`/browse/${r.instrument_slug}?p=${encodeURIComponent(r.number)}`} className="font-medium hover:underline">{r.instrument_title} &middot; {r.number}</Link>
                  <p className="mt-1 text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Documents ({results.documents.length})</h2>
            <ul className="space-y-2 text-sm">
              {results.documents.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <Link href={`/documents/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                  <div className="text-xs text-stone-500">{fmtDate(r.date_issued)} {r.number && <>&middot; {r.number}</>}</div>
                  <p className="mt-1 text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Attachments ({results.attachments.length})</h2>
            <ul className="space-y-2 text-sm">
              {results.attachments.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <Link href={`/documents/${r.document_id}`} className="font-medium hover:underline">{r.filename}</Link>
                  <div className="text-xs text-stone-500">{r.document_title}</div>
                  <p className="mt-1 text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold" dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
