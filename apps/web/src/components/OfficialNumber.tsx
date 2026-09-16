import { fileHref, pdfHref } from "@/lib/files";
import type { OfficialFile } from "@/lib/queries";

/** A notification number that opens the official file the notification was issued as.
 *
 * The number is what practitioners cite and what they want to check against the source, so the number itself
 * should be the handle that reaches the source. The document title beside it keeps linking to our page about
 * the notification: two destinations on purpose, one for what we recorded and one for what the regulator
 * actually published.
 *
 * When no file has been stored the number stays plain text rather than falling back to the regulator's
 * landing page. Those pages move, get re-numbered and expire -- a citation that quietly leads to the wrong
 * document is worse than one that leads nowhere, and the title link already offers a route to whatever we do
 * hold.
 */
export function OfficialNumber({
  doc,
  number,
  page,
  className = "",
}: {
  doc: OfficialFile;
  number: string | null | undefined;
  /** Jump straight to the page inside the PDF, where we know which one carries the amendment. */
  page?: number | null;
  className?: string;
}) {
  if (!number) return null;

  const href = fileHref(doc.pdf_storage_key, doc.pdf_source_url);
  if (!href) return <span className={`num ${className}`}>{number}</span>;

  // The stored file is usually a PDF but not always -- some regulators issue a Word document or a
  // spreadsheet annexure, and #page= on one of those is meaningless.
  const isPdf = doc.pdf_mime === "application/pdf" || /\.pdf($|[?#])/i.test(href);

  return (
    <a
      href={isPdf ? pdfHref(href, page) : href}
      target="_blank"
      rel="noreferrer"
      title={`Open the official ${isPdf ? "PDF" : "file"} for ${number}${page ? `, at page ${page}` : ""}`}
      className={`num inline-flex items-baseline gap-1 text-[var(--link)] hover:underline ${className}`}
    >
      {number}
      <span
        aria-hidden
        className="translate-y-px rounded-sm bg-stone-100 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-stone-600 ring-1 ring-inset ring-stone-200"
      >
        {isPdf ? "pdf" : "file"}
      </span>
      <span className="sr-only"> (opens the official {isPdf ? "PDF" : "file"} in a new tab)</span>
    </a>
  );
}
