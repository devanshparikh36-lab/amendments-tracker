import { provisionHref } from "@/lib/format";
import { INSTRUMENT_ALIASES, PARENT_ACT } from "@/lib/catalogue";

/* Turning citations in statutory text into links.
 *
 * Indian drafting cites constantly -- "subject to the provisions of sections 80C, 80CCC and 80CCD", "as
 * referred to in section 139 of the Act", "regulation 17 of the Listing Regulations" -- and following one
 * meant reading the number, going back to the contents, and finding it by hand.
 *
 * Two kinds are resolved, and no more:
 *
 *  1. A reference with no instrument named, which in drafting convention means the instrument you are
 *     reading -- except that "section" inside a set of Rules means the parent Act, because Rules do not
 *     have sections. That one exception is most of what this has to get right.
 *  2. A reference that names its instrument: "of the Income-tax Act, 1961", "of the CGST Act",
 *     "of the Act". Resolved against the instruments that actually exist here, never guessed from the
 *     words alone.
 *
 * Anything else is left as plain text. A wrong link in statutory text is worse than no link: it sends a
 * reader to the wrong law while looking exactly like help. So resolution is refused far more often than it
 * is attempted -- bare numbers, "clause (a)", "the said section", cross-references to Acts not tracked here.
 *
 * Links are not validated against the provisions that exist, because doing so would mean loading every
 * provision number of every instrument on every page -- the exact cost the reading view was rebuilt to
 * avoid. An unresolvable number lands on the instrument's own text view, which is where the reader was
 * heading anyway; that was checked rather than assumed.
 */

export type RefInstrument = {
  slug: string;
  kind: string;
  short_code: string;
  title: string;
  /** Served as the regulator's own PDF, so it has no provision pages to link to. */
  pdf_only?: boolean;
};

export type RefContext = {
  /** The instrument whose text is being read. */
  current: RefInstrument;
  /** Every instrument, for resolving a citation that names one. */
  all: RefInstrument[];
};

const UNIT = "(sections?|rules?|regulations?)";
// "80C", "12", "2(22)", "31A". Deliberately not matching a bare year: "1961" in "the Act, 1961" is not a
// section number, and treating it as one turned every Act's own title into a link.
const NUM = "\\d{1,3}[A-Z]{0,3}(?:\\(\\d{1,2}[A-Za-z]?\\))?";
const SEP = "\\s*(?:,|and|or|&)\\s*";
// The instrument a citation names, if it names one. Bounded so it cannot swallow the rest of a sentence.
const NAMED = "(?:\\s+of\\s+(?:the\\s+)?(?:said\\s+)?([A-Za-z0-9 ,.()'’-]{2,70}?))?(?=[\\s,.;:)]|$)";

const CITATION = new RegExp(`\\b${UNIT}\\s+(${NUM}(?:${SEP}${NUM})*)${NAMED}`, "gi");

function normaliseNumber(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

/** Which instrument a citation points at, or null when it cannot be resolved with confidence. */
function resolveInstrument(unit: string, named: string | undefined, ctx: RefContext): RefInstrument | null {
  const u = unit.toLowerCase().replace(/s$/, "");
  const cur = ctx.current;

  if (named) {
    const words = named.toLowerCase().replace(/[.,]+$/, "").trim();
    // "of the Act" / "of this Act" / "of the said Act": the parent Act when reading Rules, otherwise the
    // instrument in hand.
    if (/^(act|principal act|said act)$/.test(words)) {
      if (cur.kind === "act") return cur;
      const parent = PARENT_ACT[cur.slug];
      return ctx.all.find((i) => i.slug === parent) ?? null;
    }
    if (/^(rules|regulations|principal rules|said rules|these rules|these regulations)$/.test(words)) {
      return cur.kind === "rules" || cur.kind === "regulations" ? cur : null;
    }
    // A named instrument. Longest alias first, so "income tax rules" beats "income tax".
    const alias = Object.entries(INSTRUMENT_ALIASES)
      .filter(([a]) => words.includes(a))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (alias) {
      const hit = ctx.all.find((i) => i.slug === alias[1]);
      if (hit) return hit;
    }
    // Otherwise match the title, requiring a distinctive run of words rather than one common one.
    if (words.length >= 8) {
      const hit = ctx.all.find((i) => i.title.toLowerCase().includes(words));
      if (hit) return hit;
    }
    return null;
  }

  // Nothing named: drafting convention says the instrument being read -- with the one exception that a set
  // of Rules has no sections, so "section 139" inside the Rules means the Act they are made under.
  if (u === "section") {
    if (cur.kind === "act") return cur;
    const parent = PARENT_ACT[cur.slug];
    return ctx.all.find((i) => i.slug === parent) ?? null;
  }
  if (u === "rule") return cur.kind === "rules" ? cur : null;
  if (u === "regulation") {
    return cur.kind === "regulations" || cur.kind === "master_direction" || cur.kind === "master_circular"
      ? cur
      : null;
  }
  return null;
}

function href(inst: RefInstrument, unit: string, number: string): string {
  // An instrument served as a PDF has no provision pages, and its reading view ignores ?p= entirely -- so a
  // citation into one used to open the file at page 1 with nothing found, which looks like a broken link
  // rather than a limitation. ?pq= is what that view does read: it opens the official PDF with the citation
  // already searched, which lands the reader on the right page for 107 of the 195 instruments here.
  if (inst.pdf_only) {
    return `/browse/${inst.slug}/text?pq=${encodeURIComponent(`${unit} ${number}`)}`;
  }
  return provisionHref(inst.slug, normaliseNumber(number));
}

/** Link the citations in one run of already-escaped text. Returns HTML. */
function linkifyChunk(escaped: string, ctx: RefContext): string {
  if (!escaped || !/\d/.test(escaped)) return escaped;
  return escaped.replace(CITATION, (whole, unit: string, numbers: string, named?: string) => {
    const target = resolveInstrument(unit, named, ctx);
    if (!target) return whole;
    const sameInstrument = target.slug === ctx.current.slug;
    // Each number in "80C, 80CCC and 80CCD" becomes its own link; the separators stay as written.
    // "sections 80C, 80CCC and 80CCD" is one citation of three provisions, so each tooltip names one of
    // them in the singular rather than repeating the plural the sentence used.
    const one = unit.toLowerCase().replace(/s$/, "");
    const linkedNumbers = numbers.replace(new RegExp(NUM, "g"), (num) => {
      const title = sameInstrument ? `${one} ${num}` : `${one} ${num} of ${target.title}`;
      // target="_blank" because a citation is an aside: you follow it, read it and come back to the
      // sentence you were in the middle of. Losing your place in a 900-section Act to check one
      // cross-reference is the behaviour this is meant to remove, not reproduce.
      return `<a class="xref" href="${href(target, one, num)}" target="_blank" rel="noreferrer" title="${title}">${num}</a>`;
    });
    return whole.replace(numbers, linkedNumbers);
  });
}

const TAG = /<[^>]+>/g;

/** Link citations inside the regulator's own HTML, touching only the text between tags. */
export function linkifyLegalHtml(html: string, ctx: RefContext): string {
  let out = "";
  let last = 0;
  let insideAnchor = 0;
  for (const m of html.matchAll(TAG)) {
    const chunk = html.slice(last, m.index);
    out += insideAnchor > 0 ? chunk : linkifyChunk(chunk, ctx);
    const tag = m[0];
    // Never nest a link inside a link: the regulator's markup carries its own anchors in places.
    if (/^<a\b/i.test(tag)) insideAnchor += 1;
    else if (/^<\/a\s*>/i.test(tag)) insideAnchor = Math.max(0, insideAnchor - 1);
    out += tag;
    last = m.index + tag.length;
  }
  const tail = html.slice(last);
  out += insideAnchor > 0 ? tail : linkifyChunk(tail, ctx);
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Link citations in plain text. Returns HTML, with the source's own line breaks left intact. */
export function linkifyLegalText(text: string, ctx: RefContext): string {
  return linkifyChunk(escapeHtml(text), ctx);
}
