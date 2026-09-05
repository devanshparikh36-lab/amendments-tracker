import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { fmtDate, slugifyNumber } from "@/lib/format";
import { getInstrument, instrumentDocuments, listProvisions, provisionDocuments } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ p?: string; asOn?: string }>;

export default async function InstrumentPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;
  const inst = await getInstrument(slug);
  if (!inst) notFound();
  const [provisions, docs] = await Promise.all([listProvisions(inst.id, sp.asOn), instrumentDocuments(inst.id)]);
  const selected = sp.p ? provisions.find((p) => p.number === sp.p) : undefined;
  const shown = selected ? [selected] : provisions;
  const selectedDocs = selected ? await provisionDocuments(selected.id) : [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-stone-500">
          <Link href="/browse" className="hover:underline">Regulations</Link> / {inst.regulator_code}
        </div>
        <h1 className="text-xl font-semibold">{inst.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-stone-600">
          {inst.official_updated_as_on && <span>Official consolidated text as on {fmtDate(inst.official_updated_as_on)}</span>}
          {inst.official_url && (
            <a href={inst.official_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">
              Official source
            </a>
          )}
          <form className="ml-auto flex items-center gap-2">
            {sp.p && <input type="hidden" name="p" value={sp.p} />}
            <label className="text-xs text-stone-500">View as on</label>
            <input type="date" name="asOn" defaultValue={sp.asOn ?? ""} className="rounded border border-stone-300 px-2 py-1 text-xs" />
            <button className="rounded bg-stone-800 px-2 py-1 text-xs text-white">Go</button>
            {sp.asOn && <Link href={`/browse/${slug}${sp.p ? `?p=${encodeURIComponent(sp.p)}` : ""}`} className="text-xs text-stone-500 hover:underline">current</Link>}
          </form>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr_300px]">
        <aside className="max-h-[80vh] overflow-y-auto rounded-lg border border-stone-200 bg-white p-2 text-sm">
          <Link href={`/browse/${slug}${sp.asOn ? `?asOn=${sp.asOn}` : ""}`} className={`block rounded px-2 py-1 hover:bg-stone-100 ${!sp.p ? "font-semibold" : ""}`}>
            Full text
          </Link>
          {provisions.map((p) => (
            <Link
              key={p.id}
              href={`/browse/${slug}?p=${encodeURIComponent(p.number)}${sp.asOn ? `&asOn=${sp.asOn}` : ""}`}
              className={`block truncate rounded px-2 py-1 hover:bg-stone-100 ${p.level === "chapter" ? "mt-2 text-xs font-semibold uppercase text-stone-500" : ""} ${
                p.parent_id ? "pl-5" : ""
              } ${sp.p === p.number ? "bg-stone-100 font-semibold" : ""}`}
              title={p.heading ?? p.number}
            >
              {p.level === "chapter" ? p.heading : <>{p.number}{p.heading ? ` ${p.heading}` : ""}</>}
              {p.source_kind === "machine_merged" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />}
              {p.differs > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />}
            </Link>
          ))}
        </aside>

        <article className="space-y-4">
          {shown.map((p) => (
            <section key={p.id} id={slugifyNumber(p.number)} className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <Link href={`/browse/${slug}?p=${encodeURIComponent(p.number)}`} className="font-semibold text-stone-700 hover:underline">
                  {p.number}
                </Link>
                {p.source_kind && <Badge kind={p.source_kind} />}
                {p.differs > 0 && <Badge kind="differs_from_official" />}
                {p.effective_from && <span className="text-stone-500">w.e.f. {fmtDate(p.effective_from)}</span>}
                {p.merge_confidence != null && <span className="text-stone-400">confidence {(p.merge_confidence * 100).toFixed(0)}%</span>}
                <Link href={`/browse/${slug}/${slugifyNumber(p.number)}/history`} className="ml-auto text-sky-700 hover:underline">
                  history{p.effect_count ? ` (${p.effect_count})` : ""}
                </Link>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{p.text ?? <span className="text-stone-400">No text for this date.</span>}</pre>
              {p.footnote && <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">{p.footnote}</p>}
            </section>
          ))}
          {provisions.length === 0 && (
            <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-stone-500">
              Not seeded yet. The worker seeds this regulation from the official text on its next run.
            </p>
          )}
        </article>

        <aside className="space-y-4 text-sm">
          {selected ? (
            <div className="rounded-lg border border-stone-200 bg-white p-3">
              <h3 className="mb-2 font-semibold">Documents affecting {selected.number}</h3>
              <ul className="space-y-2">
                {selectedDocs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="hover:underline">{d.title}</Link>
                    <div className="text-xs text-stone-500">
                      {fmtDate(d.date_issued)} {d.number && <>&middot; {d.number}</>}{" "}
                      {d.change_type && <Badge kind={d.change_type} />} {d.verification_status && d.verification_status !== "unchecked" && <Badge kind={d.verification_status} />}
                    </div>
                  </li>
                ))}
                {selectedDocs.length === 0 && <li className="text-stone-500">No amendments recorded for this provision.</li>}
              </ul>
            </div>
          ) : null}
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <h3 className="mb-2 font-semibold">Amendment timeline</h3>
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`} className="hover:underline">{d.title}</Link>
                  <div className="text-xs text-stone-500">
                    {fmtDate(d.date_issued)} {d.number && <>&middot; {d.number}</>} <Badge kind={d.relation} />
                  </div>
                </li>
              ))}
              {docs.length === 0 && <li className="text-stone-500">No documents tagged to this regulation yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
