import { DOC_TYPE_LABEL } from "@/lib/format";
import { listDocuments, type DocumentRow } from "@/lib/queries";
import { documentPageUrl } from "@/lib/source";

/* An Atom feed of what the regulators have issued, scopeable to one of them or to one instrument.
 *
 * Why a feed when an email digest already goes out: the digest pushes everything to everyone on one list.
 * A feed is pulled, and it can be narrowed -- someone who only handles listing compliance subscribes to
 * `?instrument=sebi-lodr-2015` and never hears about GST. Outlook and Teams both read Atom, so this needs
 * nothing installed and no account.
 *
 * Atom rather than RSS, for two reasons that matter here. Its `updated` field is a required timestamp with a
 * timezone, where RSS 2.0's `pubDate` is an RFC-822 string readers disagree about; and `id` is a required
 * stable identifier, which is what stops a reader re-announcing the same notification when its title is
 * corrected. Both are exactly the properties a tracker of amendments needs.
 *
 * Cached deliberately, because feed readers poll. A reader checking every fifteen minutes against an
 * uncached route would be one function invocation and one Neon query each time, from every subscriber -- the
 * pattern that emptied the account before. `s-maxage` lets the CDN answer nearly all of it, and the window
 * is wide because collection runs once a day: nothing here can change more often than that.
 */

// Thirty minutes at the edge, and a day of serving stale while it refreshes. Collection runs once daily at
// 07:00 IST, so a reader polling every fifteen minutes cannot see anything newer by trying harder.
const CACHE = "public, s-maxage=1800, stale-while-revalidate=86400";

const MAX_ENTRIES = 60;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Atom demands a full RFC-3339 timestamp. A document carries a date only, so midnight IST is stated. */
function stamp(date: string | null | undefined): string {
  if (!date) return new Date(0).toISOString();
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function entry(d: DocumentRow, origin: string): string {
  const ours = `${origin}/documents/${d.id}`;
  const official = documentPageUrl(d);
  const kind = DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type;
  const parts = [
    `${d.regulator_code} ${kind}`,
    d.date_effective ? `effective ${d.date_effective}` : null,
    d.affects ? `affects ${d.affects}` : null,
  ].filter(Boolean);
  return [
    "  <entry>",
    `    <title>${esc([d.number, d.title].filter(Boolean).join(" — "))}</title>`,
    `    <link rel="alternate" href="${esc(ours)}"/>`,
    // The regulator's own page as a second link, so a reader can go straight to the source from the feed.
    official ? `    <link rel="related" href="${esc(official)}"/>` : null,
    // A tag URI, not the page URL. The id must never change: these are the rows a reader has already seen,
    // and keying them on anything editable -- a title, a number, our own path -- re-announces old
    // notifications as new ones the first time a correction lands.
    `    <id>tag:as-amended,2026:document/${d.id}</id>`,
    `    <updated>${stamp(d.date_issued ?? d.first_seen_at)}</updated>`,
    `    <summary>${esc(parts.join(" · "))}</summary>`,
    "  </entry>",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // The origin is taken from the request rather than from an environment variable. There is no SITE_URL
  // configured for the web app, and a feed that hard-codes the wrong host is worse than one that does not
  // exist: readers store these links for years.
  const origin = url.origin;
  const regulator = url.searchParams.get("regulator")?.toUpperCase() || undefined;
  const instrument = url.searchParams.get("instrument") || undefined;

  /* Scoping to an instrument means "what bears on this", not "what mentions this".
   *
   * Found by reading the output rather than the code: subscribing to the Income-tax Act, 1961 returned RBI
   * circulars about remittance forms, because the Act carries 2,011 `references` tags -- documents that
   * cite it in passing -- against 226 `clarifies` and no `amends` at all. (It is amended by Finance Acts,
   * which are not tagged that way, so filtering to `amends` alone would make this feed empty, which is how
   * that obvious answer was ruled out.)
   *
   * So: amends, supersedes and clarifies by default -- the documents that change the instrument or state
   * how it is to be read. `?relation=all` restores every connection for anyone who does want the citations.
   */
  const relations =
    instrument && url.searchParams.get("relation") !== "all"
      ? ["amends", "supersedes", "clarifies"]
      : undefined;

  const docs = await listDocuments({ regulator, instrument, relations, limit: MAX_ENTRIES });

  const scope = [regulator, instrument].filter(Boolean).join(" ");
  const title = scope ? `As Amended — ${scope}` : "As Amended — Indian tax and corporate law";
  const self = `${origin}/feed.xml${url.search}`;
  const newest = docs.length ? stamp(docs[0].date_issued ?? docs[0].first_seen_at) : new Date().toISOString();

  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${esc(title)}</title>`,
    `  <subtitle>Notifications and circulars as the regulators issue them, with the amendment trail beside them.</subtitle>`,
    `  <link rel="self" href="${esc(self)}"/>`,
    `  <link rel="alternate" href="${esc(origin)}/documents"/>`,
    // Scoped, so a reader subscribed to two scopes does not see them merged into one feed.
    `  <id>tag:as-amended,2026:feed${scope ? "/" + esc(scope.replace(/\s+/g, "/")) : ""}</id>`,
    `  <updated>${newest}</updated>`,
    ...docs.map((d) => entry(d, origin)),
    "</feed>",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE,
      // Without this the CDN would serve one scope's feed to another's subscribers: the cache key is the
      // path unless the varying parameters are named. The same omission once leaked scoped search
      // suggestions between Acts, which is how this is known rather than guessed.
      "Netlify-Vary": "query=regulator|instrument|relation",
    },
  });
}
