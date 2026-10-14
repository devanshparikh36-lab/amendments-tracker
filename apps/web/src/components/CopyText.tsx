"use client";

import { CopyIcon, TickIcon } from "@/components/icons";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";

/* Copy the provision's text, as the regulator wrote it.
 *
 * Distinct from "Cite this", which copies a reference *to* the provision. This copies the provision -- the
 * thing someone quoting a section into an opinion or a client note actually needs, and the step that
 * currently means dragging a selection across a page of indented clauses and hoping the proviso came with
 * it.
 *
 * The text is read out of the rendered element rather than passed down from the server, which is the whole
 * reason this works for both kinds of provision. Where the regulator publishes formatted HTML -- as the
 * income-tax department does for every section -- the stored value is markup, and a copy button fed that
 * would paste tags; where there is only plain text, the stored value is already right. `innerText` collapses
 * that distinction by reading what is on screen: it resolves the markup, keeps the line breaks that are
 * visible, and drops the ones that are not. What gets pasted is what was being read.
 *
 * A source line goes on the end. It costs one line and it is the difference between a quotation that can be
 * checked and a paragraph of statute floating in a document with nothing to say where it came from -- which
 * is the error this whole site exists to make harder.
 */
export function CopyText({
  targetId,
  title,
  source,
  icon = false,
}: {
  /** id of the element holding the rendered provision text. */
  targetId: string;
  /** "Section 80C — Deduction in respect of life insurance premia, etc." */
  title: string;
  /** The regulator's own page or file for this provision, when there is one. */
  source?: string | null;
  /** Render as an icon. The action row on a section page carries eight of these; most must be glyphs. */
  icon?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const el = document.getElementById(targetId);
    // Nothing to copy is not a failure to report: the button is only rendered beside text that exists, so
    // this is the defensive branch, not an expected one.
    if (!el) return;
    const body = (el as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").trim();
    if (!body) return;

    const payload = [title, "", body, "", source ? `Source: ${source}` : null]
      .filter((l) => l !== null)
      .join("\n")
      .trim();

    setState((await copyText(payload)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  }

  const said = state === "copied" ? "Text copied" : state === "failed" ? "Copy refused" : "Copy text";

  if (icon) {
    /* The outcome still has to be announced -- a tick is invisible to a screen reader, and "did that
       work?" is the entire question this button answers. The live region carries the words; the glyph
       carries them for everyone else. */
    return (
      <button type="button" onClick={copy} className="icon-btn no-print" aria-label={said} title={said}>
        {state === "copied" ? <TickIcon /> : <CopyIcon />}
        <span className="sr-only" aria-live="polite">
          {state === "idle" ? "" : said}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={copy} className="btn no-print" aria-live="polite">
      {said}
    </button>
  );
}
