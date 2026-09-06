import Link from "next/link";
import { redirect } from "next/navigation";
import { KIND_LABEL } from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { provisionHref, resolveLookup } from "@/lib/lookup";
import { search } from "@/lib/queries";

export const dynamic = "force-dynamic";

// One box for everything. A query that names one obvious provision goes straight there;
// anything else lands on a short list of one-click answers.
export default async function FindPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  if (!q) redirect("/");

  const lookup = await resolveLookup(q);
  if (lookup.jumpTo && sp.all !== "1") redirect(lookup.jumpTo);

  const text = await search(q, 25);
  const nothing =
    !lookup.provisions.length && !lookup.instruments.length && !text.provisions.length && !text.documents.length && !text.attachments.length;

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <form action="/find" role="search" className="flex flex-wrap gap-2">
        <label htmlFor="find-q" className="sr-only">
          Search
        </label>
        <input
          id="find-q"
          name="q"
          defaultValue={q}
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-stone-300 px-4 py-2.5 text-base focus:border-stone-600 focus:outline-none"
        />
        <button className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-white hover:bg-[#173618]">Search</button>
      </form>

      {sp.all === "1" && lookup.jumpTo && (
        <p className="text-sm text-stone-600">
          Showing every match for &ldquo;{q}&rdquo;.{" "}
          <Link href={lookup.jumpTo} className="text-[var(--link)] hover:underline">
            Go to the best match
          </Link>
        </p>
      )}

      {lookup.provisions.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">
            {lookup.parsed.number} in {lookup.provisions.length === 1 ? "one instrument" : `${lookup.provisions.length} instruments`}
          </h2>
          <ol className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {lookup.provisions.map((p) => (
              <li key={p.id}>
                <Link href={provisionHref(p.instrument_slug, p.number)} className="block px-4 py-2.5 hover:bg-stone-50">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-stone-900">
                      {labelFor(p.kind)} {p.number}
                    </span>
                    <span className="text-sm text-stone-700">{p.heading?.replace(/[.\-\s]+$/, "")}</span>
                    <span className="ml-auto text-xs text-stone-500">{p.instrument_title}</span>
                  </div>
                  {p.snippet && <p className="mt-0.5 line-clamp-2 text-[13px] text-stone-500">{p.snippet}</p>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {lookup.instruments.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">Regulations</h2>
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {lookup.instruments.map((i) => (
              <li key={i.id}>
                <Link href={`/browse/${i.slug}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-stone-50">
                  <span className="min-w-0 flex-1 text-sm text-stone-800">{i.title}</span>
                  <span className="whitespace-nowrap text-xs text-stone-500">
                    {KIND_LABEL[i.kind] ?? i.kind}
                    {i.provision_count > 0 ? ` · ${i.provision_count} provisions` : " · no text yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {text.provisions.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">
            In the consolidated text
          </h2>
          <ul className="space-y-2">
            {text.provisions.map((r) => (
              <li key={r.provision_id} className="rounded-lg border border-stone-200 bg-white p-3">
                <Link href={provisionHref(r.instrument_slug, r.number)} className="font-medium hover:underline">
                  {r.instrument_title} · {r.number}
                </Link>
                <p
                  className="mt-1 text-sm text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(text.documents.length > 0 || text.attachments.length > 0) && (
        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">
              Notifications and circulars
            </h2>
            <ul className="space-y-2">
              {text.documents.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <Link href={`/documents/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <div className="text-xs text-stone-500">
                    {fmtDate(r.date_issued)} {r.number && <>· {r.number}</>}
                  </div>
                  <p
                    className="mt-1 text-sm text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                </li>
              ))}
              {text.documents.length === 0 && <li className="text-sm text-stone-500">Nothing.</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">Inside PDFs</h2>
            <ul className="space-y-2">
              {text.attachments.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <Link href={`/documents/${r.document_id}`} className="font-medium hover:underline">
                    {r.filename}
                  </Link>
                  <div className="text-xs text-stone-500">{r.document_title}</div>
                  <p
                    className="mt-1 text-sm text-stone-600 [&_b]:bg-yellow-100 [&_b]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                </li>
              ))}
              {text.attachments.length === 0 && <li className="text-sm text-stone-500">Nothing.</li>}
            </ul>
          </div>
        </section>
      )}

      {nothing && (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          Nothing matches &ldquo;{q}&rdquo;. Try a section number on its own (<em>80C</em>), a regulation short name
          (<em>LODR</em>), or a phrase from the text.
        </p>
      )}
    </div>
  );
}

function labelFor(kind: string): string {
  if (kind === "rules") return "Rule";
  if (kind === "regulations") return "Regulation";
  if (kind === "master_direction" || kind === "master_circular") return "Para";
  return "Section";
}
