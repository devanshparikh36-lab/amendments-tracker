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
  if (!href) {
    // Still legible, still obviously the citation -- just not a link, because there is nothing to open.
    return <span className={`numchip-plain ${className}`}>{number}</span>;
  }

  // The stored file is usually a PDF but not always -- some regulators issue a Word document or a
  // spreadsheet annexure, and #page= on one of those is meaningless.
  const isPdf = doc.pdf_mime === "application/pdf" || /\.pdf($|[?#])/i.test(href);

  // A bordered chip rather than coloured text. Sitting beside a title that is itself a link, plain blue text
  // reads as a continuation of that title; the border makes it a separate thing you can press. It also gives
  // a real touch target on a phone, where these numbers are otherwise a few millimetres of text.
  //
  // Numbers wrap rather than truncate: SEBI issues citations like HO/47/16/13(5)2026-MRD-POD1/I/20735/2026
  // and half of one is no use to anybody.
  //
  // Styled by class, not by utilities. This renders once per row, and the utility strings alone were 31 KB of
  // the documents listing. The title attribute carries the description instead of a visually-hidden span,
  // which is the same information without repeating a sentence a hundred times down the page.
  return (
    <a
      href={isPdf ? pdfHref(href, page) : href}
      target="_blank"
      rel="noreferrer"
      title={`Opens the official ${isPdf ? "PDF" : "file"} for ${number}${page ? `, at page ${page}` : ""}, in a new tab`}
      className={className ? `numchip ${className}` : "numchip"}
    >
      <span className="numchip-n">{number}</span>
      <span aria-hidden className="numchip-tag">
        {isPdf ? "pdf" : "file"}
      </span>
    </a>
  );
}
