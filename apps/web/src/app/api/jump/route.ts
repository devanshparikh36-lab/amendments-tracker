import { NextRequest, NextResponse } from "next/server";
import { query } from "@/db";
import { fileHref, pdfHref } from "@/lib/files";
import { bestPageFor, readPageIndex } from "@/lib/r2";

export const dynamic = "force-dynamic";

// Opens a search result at the page that answers it.
//
// Resolved on click rather than when the results are rendered: finding the page means reading that document's
// page file out of object storage, and doing that for fifty results to serve the one the reader picks would
// make every search slow to save a click. Here it costs one read, only for the document actually chosen.
//
// Degrades rather than fails at every step. A document with no stored file, no page index, or no page that
// matches still lands the reader on the document page, which is where they would have gone anyway.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const documentId = Number(sp.get("doc") ?? 0);
  const attachmentId = Number(sp.get("att") ?? 0);
  const q = (sp.get("q") ?? "").trim();
  const fallback = documentId ? `/documents/${documentId}` : "/";
  if (!documentId && !attachmentId) return NextResponse.redirect(new URL("/", req.url));

  const rows = await query<{
    document_id: number;
    storage_key: string | null;
    page_index_key: string | null;
    source_url: string | null;
  }>(
    attachmentId
      ? `SELECT document_id, storage_key, page_index_key, source_url FROM attachment WHERE id = $1`
      : `SELECT document_id, storage_key, page_index_key, source_url FROM attachment
          WHERE document_id = $1 AND storage_key IS NOT NULL
          ORDER BY is_primary DESC, id LIMIT 1`,
    [attachmentId || documentId],
    // The page file cannot change without the document being re-fetched, so this is safe to cache for a
    // while; it is the object-storage read we are paying for, not the row.
    600,
  );

  const att = rows[0];
  if (!att?.storage_key) {
    return NextResponse.redirect(new URL(documentId ? fallback : `/documents/${att?.document_id ?? ""}`, req.url));
  }
  const url = fileHref(att.storage_key, att.source_url);
  const pages = q ? await readPageIndex(att.page_index_key) : null;
  const page = pages ? bestPageFor(pages, q) : null;

  // An absolute R2 URL must not be rewritten against this origin; a relative proxy path must.
  const target = pdfHref(url, page, true);

  // ?explain=1 reports the decision instead of acting on it. Worth keeping: the redirect usually ends at an
  // absolute R2 URL, so neither the browser nor a script can see which page was chosen after the fact, and
  // "it opened the wrong page" is otherwise impossible to investigate.
  if (sp.get("explain")) {
    return NextResponse.json({
      attachment_id: attachmentId || null,
      document_id: att.document_id,
      storage_key: att.storage_key,
      page_index: att.page_index_key || null,
      pages_indexed: pages?.length ?? 0,
      query: q,
      chosen_page: page,
      target,
    });
  }
  return NextResponse.redirect(target.startsWith("http") ? target : new URL(target, req.url));
}
