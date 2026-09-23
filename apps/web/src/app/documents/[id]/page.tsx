import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Diff } from "@/components/Diff";
import { fileHref } from "@/lib/files";
import { DOC_TYPE_LABEL, fmtBytes, fmtDate } from "@/lib/format";
import { query } from "@/db";
import { provisionHref } from "@/lib/lookup";
import { getDocument } from "@/lib/queries";

// A notification does not change after it is published. What can change is our tagging of it, which happens
// during collection, so an hour is generous and still far fresher than the document itself will ever be.
export const revalidate = 3600;

/* Prerender the recent ones, render the rest on demand and keep them.
 *
 * `revalidate` alone left this route fully dynamic: a segment with a parameter and no list of values cannot
 * be built ahead of time, so Next rendered it per request and sent `no-store` with every response -- a
 * function invocation for every view of every notification, including the same one twice.
 *
 * There are 8,003 documents and prerendering all of them would make every build absurd for pages nobody
 * opens. The recent ones are what anybody actually follows a link to, so those are built; `dynamicParams`
 * leaves the rest reachable, rendered once on first request and then cached like the others.
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  // Deliberately tolerant: a build must not fail because the database is unreachable. With no list, every
  // document simply falls through to on-demand rendering, which is where they were already.
  try {
    const rows = await query<{ id: number }>(
      `SELECT id FROM document ORDER BY first_seen_at DESC LIMIT 100`,
      [],
      3600,
    );
    return rows.map((r) => ({ id: String(r.id) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDocument(Number(id));
  return { title: data ? data.doc.title.slice(0, 70) : "Document" };
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDocument(Number(id));
  if (!data) notFound();
  const { doc, attachments, tags, effects } = data;
  const primary = attachments.find((a) => a.is_primary && a.storage_key) ?? attachments.find((a) => a.storage_key);

  return (
    <div className="space-y-5">
      <header className="panel px-6 py-5">
        <p className="crumbs no-print">
          <Link href="/">Home</Link> / <Link href="/documents">Notifications</Link> /{" "}
          <Link href={`/documents?regulator=${doc.regulator_code}`}>{doc.regulator_code}</Link>
        </p>
        <h1 className="page-title mt-1">{doc.title}</h1>
        <div className="meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</span>
          {doc.number && <span>· {doc.number}</span>}
          {doc.date_issued && <span className="num">· issued {fmtDate(doc.date_issued)}</span>}
          {doc.date_effective && <span className="num">· effective {fmtDate(doc.date_effective)}</span>}
          <Badge kind={doc.tag_status} />
          {doc.is_amending === true && <Badge kind="amends">amending</Badge>}
          {doc.is_amending === false && <Badge kind="references">not amending</Badge>}
          <a
            href={doc.source_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[var(--link)] hover:underline"
          >
            Official source page &rarr;
          </a>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="min-w-0 space-y-5">
          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">The document, verbatim</h2>
            </div>
            <div className="panel-body">
              {doc.extracted_text ? (
                <div className="legal-pre">{doc.extracted_text}</div>
              ) : (
                <p className="text-[var(--ink-3)]">
                  Text not extracted yet — open the official source or the stored file alongside.
                </p>
              )}
            </div>
          </section>

          {effects.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow">Changes applied to the consolidated text</h2>
              {effects.map((e) => (
                <div key={e.id} className="panel panel-body">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                    <Link
                      href={provisionHref(e.instrument_slug, e.provision_number)}
                      className="font-semibold hover:underline"
                    >
                      {e.instrument_title} &middot; {e.provision_number}
                    </Link>
                    <Badge kind={e.change_type} />
                    <Badge kind={e.verification_status} />
                    {e.confidence != null && (
                      <span className="num text-[var(--ink-4)]">confidence {(e.confidence * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  {e.change_type === "cannot_apply" ? (
                    <p className="text-[13.5px] text-[var(--flag-alert)]">{e.ai_note}</p>
                  ) : e.new_text ? (
                    <>
                      <Diff before={e.old_text ?? ""} after={e.new_text} />
                      {e.footnote && (
                        <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[12px] text-[var(--ink-3)]">
                          {e.footnote}
                        </p>
                      )}
                      {e.ai_note && <p className="mt-1 text-[12px] text-[var(--ink-3)]">{e.ai_note}</p>}
                    </>
                  ) : (
                    <div className="text-[13.5px]">
                      <p className="text-[var(--ink-2)]">Amending instruction, verbatim:</p>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-[14.5px] leading-relaxed">{e.ai_note}</pre>
                      <p className="mt-2 text-[12px] text-[var(--ink-3)]">
                        Merged text is not generated in this deployment; the official document above is the authority.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">Files</h2>
            </div>
            <ul className="feed px-4 py-1 text-[13px]">
              {attachments.map((a) => (
                <li key={a.id} className="py-2">
                  <a
                    href={fileHref(a.storage_key, a.source_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--link)] hover:underline"
                  >
                    {a.filename}
                  </a>
                  <div className="meta">
                    {a.is_primary && "primary · "}
                    {a.mime} {a.size_bytes ? `· ${fmtBytes(a.size_bytes)}` : ""}{" "}
                    {a.page_count ? `· ${a.page_count} pp` : ""}
                    {a.ocr_used && " · OCR"}
                    {!a.storage_key && " · not downloaded yet"}
                  </div>
                  {a.extracted_text && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-[var(--ink-3)]">
                        Text read out of this file
                      </summary>
                      <pre className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed">
                        {a.extracted_text}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
              {attachments.length === 0 && <li className="py-2 text-[var(--ink-3)]">No attachments.</li>}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="eyebrow">Relates to</h2>
            </div>
            <ul className="feed px-4 py-1 text-[13px]">
              {tags.map((t, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1.5 py-1.5">
                  <Link
                    href={t.provision_number ? provisionHref(t.slug, t.provision_number) : `/browse/${t.slug}`}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    {t.title}
                    {t.provision_number ? ` · ${t.provision_number}` : ""}
                  </Link>
                  <Badge kind={t.relation} />
                </li>
              ))}
              {tags.length === 0 && (
                <li className="py-2 text-[var(--ink-3)]">
                  {doc.tag_status === "pending" ? "Not yet tagged." : "No regulation tagged."}
                </li>
              )}
            </ul>
          </section>

          {primary && primary.mime === "application/pdf" && (
            <section className="panel no-print overflow-hidden">
              <div className="panel-head">
                <h2 className="eyebrow">The stored file</h2>
              </div>
              <iframe
                src={fileHref(primary.storage_key, primary.source_url)}
                className="h-[70vh] w-full"
                title={primary.filename}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
