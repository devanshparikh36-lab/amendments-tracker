import { fmtDate } from "@/lib/format";

/* The header and footer a printed provision needs, and which the screen does not.
 *
 * Printing already worked -- there is a print stylesheet, `.no-print` hides the furniture, and external
 * links print their URL after the text. What came out was still not a document: a page of statutory text
 * with no statement of what it is, what date it speaks as of, or where it came from. Put in a file, it is
 * a paragraph nobody can date.
 *
 * So a printed copy carries the same four facts the "Cite this" button puts on the clipboard, for the same
 * reason: "as amended" means nothing without the date it was amended to, and that is the field people
 * leave out.
 *
 * Print-only, via `hidden print:block`. On screen all of this is already in the header and the tabs; a
 * second copy would be clutter, and the two would drift.
 *
 * No firm letterhead here. A real one is a logo, an address and a typeface I do not have, and inventing
 * something that looks like a firm's stationery would be worse than a plain heading -- a document that
 * looks official and is not. This states what the document is and leaves the letterhead to be set
 * deliberately.
 */
export function PrintHeader({
  instrument,
  unit,
  number,
  heading,
  asOn,
  officialUrl,
}: {
  instrument: string;
  unit?: string;
  number?: string | null;
  heading?: string | null;
  asOn?: string | null;
  officialUrl?: string | null;
}) {
  const title =
    number && unit ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)} ${number}, ${instrument}` : instrument;
  return (
    <>
      <header className="hidden print:block print-head">
        <p className="print-head-rule">{title}</p>
        {heading && <p className="print-head-sub">{heading.replace(/[.\-\s]+$/, "")}</p>}
        <p className="print-head-meta">
          {asOn ? <>Text as on {fmtDate(asOn)}. </> : null}
          Retrieved {fmtDate(new Date().toISOString())} from As Amended.
        </p>
      </header>
      <footer className="hidden print:block print-foot">
        {officialUrl ? <>Official source: {officialUrl}</> : null}
        <span className="print-foot-note">
          A reproduction of the regulator&rsquo;s own text, for reference. Not legal advice.
        </span>
      </footer>
    </>
  );
}
