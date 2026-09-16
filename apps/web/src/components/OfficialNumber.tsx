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
    return <span className={`num text-[12.5px] text-[var(--ink-3)] ${className}`}>{number}</span>;
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
  return (
    <a
      href={isPdf ? pdfHref(href, page) : href}
      target="_blank"
      rel="noreferrer"
      title={`Open the official ${isPdf ? "PDF" : "file"} for ${number}${page ? `, at page ${page}` : ""}`}
      className={`group inline-flex max-w-full items-center gap-1.5 rounded border border-[var(--rule)] bg-[var(--paper)] px-2 py-[3px] align-middle transition-colors hover:border-[var(--link)] hover:bg-white ${className}`}
    >
      <span className="num break-words text-[12.5px] font-medium leading-snug text-[var(--link)]">{number}</span>
      <span
        aria-hidden
        className="shrink-0 rounded-sm bg-stone-200/70 px-1 text-[10px] font-semibold uppercase leading-[1.5] tracking-wide text-stone-700 group-hover:bg-stone-300/70"
      >
        {isPdf ? "pdf" : "file"}
      </span>
      <span className="sr-only"> (opens the official {isPdf ? "PDF" : "file"} in a new tab)</span>
    </a>
  );
}
