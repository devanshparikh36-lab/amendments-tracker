/* Putting text on the clipboard, in the order that actually works.
 *
 * Extracted from CiteThis when a second button needed the same thing. The order below is the whole value of
 * this file, and it is not the obvious one -- the obvious one was written first and was useless in the case
 * that occurs.
 *
 * The obvious version tries `navigator.clipboard.writeText` when it exists and falls back to `execCommand`
 * when it does not. That reads sensibly and never helps: the API is almost always *present*, so the fallback
 * is skipped, and then it throws because `clipboard-write` is denied -- which is what a browser does on an
 * insecure origin, inside some embedded views, and under a permissions policy that omits clipboard-write.
 * The button then dies with a perfectly good synchronous path sitting unused behind an `else`.
 *
 * So: try the modern API, and if it throws for any reason try the deprecated one before giving up. Both
 * failing is a real state and callers must handle it -- hence a boolean rather than a throw.
 */

/** The old way. Deprecated, synchronous, and still the only one that works when permission is refused. */
function byExecCommand(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    // Fixed and transparent rather than off-screen: scrolling the page to an element at left:-9999px is
    // what the off-screen trick does on some browsers, and it does it to the reader's position.
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** True if the text reached the clipboard by either route. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return byExecCommand(text);
    }
  }
  return byExecCommand(text);
}
