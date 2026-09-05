import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { DOC_TYPE_LABEL, fmtBytes, fmtDate } from "@/lib/format";
import { getDocument } from "@/lib/queries";

export const dynamic = "force-dynamic";

function fileHref(storageKey: string | null, sourceUrl: string): string {
  if (!storageKey) return sourceUrl;
  const base = process.env.R2_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${storageKey}` : `/api/files/${storageKey}`;
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDocument(Number(id));
  if (!data) notFound();
  const { doc, attachments, tags, effects } = data;
  const primary = attachments.find((a) => a.is_primary && a.storage_key) ?? attachments.find((a) => a.storage_key);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-stone-500"><Link href="/documents" className="hover:underline">Documents</Link> / {doc.regulator_code}</div>
        <h1 className="text-xl font-semibold">{doc.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-stone-600">
          <span>{DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</span>
          {doc.number && <span>{doc.number}</span>}
          {doc.date_issued && <span>issued {fmtDate(doc.date_issued)}</span>}
          {doc.date_effective && <span>effective {fmtDate(doc.date_effective)}</span>}
          <Badge kind={doc.tag_status} />
          {doc.is_amending === true && <Badge kind="amends">amending</Badge>}
          {doc.is_amending === false && <Badge kind="references">not amending</Badge>}
          <a href={doc.source_url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">Official source page</a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Verbatim text</h2>
            {doc.extracted_text ? (
              <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{doc.extracted_text}</pre>
            ) : (
              <p className="text-stone-500">Text not yet extracted.</p>
            )}
          </section>

          {effects.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Changes applied to consolidated text</h2>
              {effects.map((e) => (
                <div key={e.id} className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <Link href={`/browse/${e.instrument_slug}?p=${encodeURIComponent(e.provision_number)}`} className="font-semibold hover:underline">
                      {e.instrument_title} &middot; {e.provision_number}
                    </Link>
                    <Badge kind={e.change_type} />
                    <Badge kind={e.verification_status} />
                    {e.confidence != null && <span className="text-stone-400">confidence {(e.confidence * 100).toFixed(0)}%</span>}
                  </div>
                  {e.change_type === "cannot_apply" ? (
                    <p className="text-sm text-red-800">{e.ai_note}</p>
                  ) : e.new_text ? (
                    <>
                      <Diff before={e.old_text ?? ""} after={e.new_text} />
                      {e.footnote && <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">{e.footnote}</p>}
                      {e.ai_note && <p className="mt-1 text-xs text-stone-500">{e.ai_note}</p>}
                    </>
                  ) : (
                    <p className="text-sm text-stone-500">Pending merge.</p>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="space-y-4 text-sm">
          <section className="rounded-lg border border-stone-200 bg-white p-3">
            <h3 className="mb-2 font-semibold">Files</h3>
            <ul className="space-y-2">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={fileHref(a.storage_key, a.source_url)} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{a.filename}</a>
                  <div className="text-xs text-stone-500">
                    {a.is_primary && "primary · "}{a.mime} {a.size_bytes ? `· ${fmtBytes(a.size_bytes)}` : ""} {a.page_count ? `· ${a.page_count} pp` : ""}
                    {a.ocr_used && " · OCR"}
                    {!a.storage_key && " · not downloaded yet"}
                  </div>
                  {a.extracted_text && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-stone-600">Extracted text</summary>
                      <pre className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">{a.extracted_text}</pre>
                    </details>
                  )}
                </li>
              ))}
              {attachments.length === 0 && <li className="text-stone-500">No attachments.</li>}
            </ul>
          </section>

          <section className="rounded-lg border border-stone-200 bg-white p-3">
            <h3 className="mb-2 font-semibold">Relates to</h3>
            <ul className="space-y-1">
              {tags.map((t, i) => (
                <li key={i}>
                  <Link href={`/browse/${t.slug}${t.provision_number ? `?p=${encodeURIComponent(t.provision_number)}` : ""}`} className="hover:underline">
                    {t.title}{t.provision_number ? ` · ${t.provision_number}` : ""}
                  </Link>{" "}
                  <Badge kind={t.relation} />
                </li>
              ))}
              {tags.length === 0 && <li className="text-stone-500">{doc.tag_status === "pending" ? "Not yet tagged." : "No regulation tagged."}</li>}
            </ul>
          </section>

          {primary && primary.mime === "application/pdf" && (
            <section className="rounded-lg border border-stone-200 bg-white p-1">
              <iframe src={fileHref(primary.storage_key, primary.source_url)} className="h-[70vh] w-full" title={primary.filename} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
