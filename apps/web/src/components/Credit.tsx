import { PUBLISHER, PUBLISHER_URL } from "@/lib/legal";

/* Who made this, and the one outbound link on the site that is not a regulator.
 *
 * Two pieces, used in different places:
 *
 *   <PublisherName/>  the publisher's name wherever it appears in the written pages, as a link. There are
 *                     five such mentions across /about, /privacy and /terms, and they all read from the
 *                     same constant -- so this exists to stop four of them drifting into plain text the
 *                     day somebody edits one.
 *
 *   <Credit/>         the line at the top of /about: designed by Claude, curated by a person, with a mark
 *                     that leaves. It sits on that one page and not in the site footer, because a credit
 *                     repeated under every provision of the Income-tax Act is a signature on somebody
 *                     else's work -- the law on the page is the regulator's, not ours.
 *
 * The LinkedIn glyph is drawn here rather than fetched. /privacy promises that nothing on this site loads
 * a script, stylesheet, font or image from a third party, and pulling a logo off LinkedIn's CDN would have
 * made that promise false for the sake of a few hundred bytes -- while also telling LinkedIn about every
 * reader who merely loaded a page, rather than only those who chose to follow the link.
 */

/** 24-unit grid like the rest of the icon set, but solid: this is a wordmark, not a line icon. */
function LinkedInMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      /* Sized in em and nudged by a sliver, which is what actually makes it sit level with the words.
       *
       * A square glyph centred on the text box always reads a touch high next to lowercase letters,
       * because the visual centre of a line of type sits below its geometric centre. `align-middle` plus
       * a small lift lands it on the x-height instead, and because both the size and the offset are
       * relative, it stays aligned if this line is ever set larger or smaller.
       *
       * -0.11em rather than a rounder number: at -0.06 the glyph measured 0.69px low against the centre
       * of the adjacent link, which is 0.048em at this size. Measured against the rendered page rather
       * than guessed, which is the only way to settle a number this small. */
      style={{ verticalAlign: "middle", position: "relative", top: "-0.11em" }}
    >
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.65h.05A4.17 4.17 0 0 1 17.6 8.7c3.99 0 4.73 2.5 4.73 5.76V21h-4v-5.72c0-1.37-.03-3.12-1.95-3.12-1.95 0-2.25 1.48-2.25 3.02V21h-4V9Z" />
    </svg>
  );
}

/** The publisher's name, linked. Used wherever the name is printed in the written pages. */
export function PublisherName({ strong = false }: { strong?: boolean }) {
  return (
    <a
      href={PUBLISHER_URL}
      target="_blank"
      // noreferrer as well as noopener: the first is a security measure, the second keeps this site's path
      // out of what LinkedIn is told, matching the Referrer-Policy set for every other outbound link.
      rel="noopener noreferrer me"
      className={`text-[var(--link)] hover:underline ${strong ? "font-medium" : ""}`}
    >
      {PUBLISHER}
    </a>
  );
}

/* The credit, at the top of /about.
 *
 * "Designed by Claude, curated by <name>" and not the other way round, because it is the honest division:
 * the writing, the layout and the code came out of a conversation with Claude, and the judgement about
 * what belongs in a law library -- which regulators, which instruments, what counts as a definition --
 * did not. Curation is the word for that and it is not a modest one.
 *
 * No font size of its own. It inherits the prose it sits in, so it reads as the first line of the page
 * rather than as a caption bolted above it -- which is what a smaller size would have made it.
 */
export function Credit() {
  return (
    <p className="text-[var(--ink-2)]">
      Designed by Claude <span className="text-[var(--ink-4)]">&middot;</span> Curated by <PublisherName />{" "}
      <a
        href={PUBLISHER_URL}
        target="_blank"
        rel="noopener noreferrer me"
        aria-label={`${PUBLISHER} on LinkedIn`}
        title={`${PUBLISHER} on LinkedIn`}
        /* A second target for the same place, so it is padded to be hit rather than squinted at: the
         * negative margin lets the 24px tap area overhang the line without pushing the text apart. */
        className="-my-1 ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded align-middle text-[var(--ink-3)] hover:text-[var(--link)]"
      >
        <LinkedInMark />
      </a>
    </p>
  );
}
