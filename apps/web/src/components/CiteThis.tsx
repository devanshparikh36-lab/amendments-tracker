"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

/* A citation for the provision on screen, ready to paste into a memo.
 *
 * The gap this fills is not a missing feature so much as a missing last step. Everything a practitioner
 * needs to cite a section correctly is already on the page -- the instrument's full title, the number, the
 * heading, the date the regulator states its text as -- and every one of them has to be retyped, which is
 * where the errors come from. Dates especially: "as amended" means nothing in a file note without the date
 * it was amended to, and that is the field people leave out.
 *
 * What goes in, and why each part earns its place:
 *
 *   Section 80C, Income-tax Act, 1961 — Deduction in respect of life insurance premia, etc.
 *   Text as on 28 September 2026. Retrieved 10 October 2026.
 *   Official source: https://www.incometaxindia.gov.in/w/section-80c-63
 *   As Amended: https://as-amended.netlify.app/browse/ita-1961/text?p=80C
 *
 * Two dates, not one, because they answer different questions: "as on" is the regulator's own statement
 * about its consolidation, and "retrieved" is when we read it. A reader checking the note in two years needs
 * both to know whether it is still current.
 *
 * The official source comes first and ours second. A citation that leads with us would be asking a reader to
 * take this site's word for the law; leading with the regulator's own address means the note stands up
 * without us.
 *
 * The origin is read after mount rather than passed in from the server. There is no SITE_URL configured for
 * the web app, and inventing one in the environment to build a string the browser already knows would be a
 * deployment detail that can silently go stale -- a citation pointing at the wrong host is worse than one
 * that waits a tick for hydration.
 */

export function CiteThis({
  unit,
  number,
  heading,
  instrument,
  asOn,
  officialUrl,
  path,
}: {
  /** "section" / "rule" / "regulation". Unused when there is no number to attach it to. */
  unit?: string;
  /** Omitted for an instrument served as one consolidated PDF: there are no provisions to cite separately,
   *  so the citation is of the instrument, and claiming a section it cannot link to would be worse. */
  number?: string | null;
  heading?: string | null;
  instrument: string;
  /** The date the regulator states its text as. */
  asOn?: string | null;
  /** The regulator's own page or file for this provision, when there is one. */
  officialUrl?: string | null;
  /** This page, relative, e.g. "/browse/ita-1961/text?p=80C". */
  path: string;
}) {
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [open, setOpen] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  // With a number: "Section 80C, Income-tax Act, 1961". Without one -- an instrument published only as a
  // consolidated PDF -- the instrument's own name is the whole citation.
  const title =
    number && unit
      ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)} ${number}, ${instrument}`
      : instrument;
  const lines = [
    heading ? `${title} — ${heading.replace(/[.\-\s]+$/, "")}` : title,
    [asOn ? `Text as on ${fmtLong(asOn)}.` : null, `Retrieved ${fmtLong(new Date())}.`]
      .filter(Boolean)
      .join(" "),
    officialUrl ? `Official source: ${officialUrl}` : null,
    `As Amended: ${origin}${path}`,
  ].filter(Boolean) as string[];
  const citation = lines.join("\n");

  async function copy() {
    // Both routes and their ordering live in lib/clipboard.ts, which explains why the order is what it is.
    const ok = await copyText(citation);
    if (ok) {
      setState("copied");
    } else {
      // Showing the text is the fallback that cannot fail: it is on screen and selected, so a browser that
      // refuses every copy path leaves the reader something to do rather than a dead button.
      setState("failed");
      setOpen(true);
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className="no-print inline-flex items-center gap-1.5">
      <button type="button" onClick={copy} className="btn" aria-live="polite">
        {state === "copied" ? "Citation copied" : state === "failed" ? "Select it below" : "Cite this"}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[12px] text-[var(--ink-3)] hover:text-[var(--link)] hover:underline"
      >
        {open ? "hide" : "show"}
      </button>
      {open && (
        <span className="mt-1 block w-full basis-full">
          <textarea
            readOnly
            value={citation}
            rows={lines.length + 1}
            onFocus={(e) => e.currentTarget.select()}
            className="field w-full font-mono text-[12px] leading-relaxed"
            aria-label="Citation for this provision"
          />
        </span>
      )}
    </span>
  );
}

/** "28 September 2026" — written out, because a citation is read by people and 09/10 is ambiguous. */
function fmtLong(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}
